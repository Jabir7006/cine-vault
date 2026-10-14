import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isMediaRepresentation } from "./types.js";
import type { MediaRegistry, MediaResource } from "./types.js";

export const MAX_MEDIA_TTL_MS = 10 * 60_000;
export const UPSTREAM_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_CAPACITY = 10_000;
const RESOURCE_KINDS = new Set<MediaResource["kind"]>(["video", "subtitle", "manifest"]);
const isResourceKind = (value: unknown): value is MediaResource["kind"] =>
  typeof value === "string" && RESOURCE_KINDS.has(value as MediaResource["kind"]);
const TOKEN_PATTERN = /^v1\.(video|subtitle|manifest)\.GET-HEAD\.([A-Za-z0-9_-]{32})\.([1-9]\d{0,15})\.([A-Za-z0-9_-]{43})$/;

export interface MediaRegistryOptions {
  /** Operator-supplied 64 hex characters, or at least 32 bytes; no default key. */
  signingKey: string | Uint8Array;
  ttlMs?: number;
  capacity?: number;
  /** Milliseconds since Unix epoch; injectable for offline tests. */
  now?: () => number;
}

interface Entry {
  resource: MediaResource;
  expiresAt: number;
}

function fail(): never {
  // Never include resource URLs, header values, signing keys or capabilities.
  throw new Error("Invalid media registry configuration or resource");
}

function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function copyResource(resource: MediaResource): MediaResource {
  if (!resource || !isResourceKind(resource.kind)) fail();
  if (typeof resource.url !== "string" || resource.url.length > 16_384 ||
      !/^https:\/\//i.test(resource.url) || /[\s\\#]/u.test(resource.url)) fail();
  let url: URL;
  try { url = new URL(resource.url); } catch { return fail(); }
  // URL normalizes explicit :443 to an empty port. Empty credentials ("@")
  // and empty fragments ("#") are rejected too, not only their parsed values.
  if (url.protocol !== "https:" || !url.hostname || url.port || url.username || url.password ||
      resource.url.slice(resource.url.indexOf("//") + 2).split("/")[0]?.includes("@")) fail();

  if (!resource.headers || typeof resource.headers !== "object" || Array.isArray(resource.headers)) fail();
  const entries = Object.entries(resource.headers);
  if (entries.length > 32) fail();
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  let headerBytes = 0;
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || typeof value !== "string" ||
        /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) fail();
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (headerBytes > 16_384) fail();
    headers[name] = value;
  }
  const copy: MediaResource = { url: url.href, kind: resource.kind, headers: Object.freeze(headers) };
  if (resource.expiresAt !== undefined) copy.expiresAt = timestamp(resource.expiresAt);
  if (resource.height !== undefined) {
    if (!Number.isSafeInteger(resource.height) || resource.height <= 0) fail();
    copy.height = resource.height;
  }
  for (const field of ["codec", "resourceId", "lang", "label"] as const) {
    const value = resource[field];
    if (value !== undefined) {
      if (typeof value !== "string" || Buffer.byteLength(value) > 1_024) fail();
      copy[field] = value;
    }
  }
  // A manifest without a readable ladder is not something the relay can offer, and only a manifest
  // has one at all: the ladder describes the single adaptive stream every one of its segments belongs to.
  if (resource.kind === "manifest") {
    const heights = resource.heights;
    if (!Array.isArray(heights) || !heights.length || heights.length > 32 ||
        heights.some((height) => !Number.isSafeInteger(height) || height < 144 || height > 8_192) ||
        new Set(heights).size !== heights.length) fail();
    copy.heights = Object.freeze([...heights]);
  } else if (resource.heights !== undefined) fail();

  if (resource.captionFormat !== undefined) {
    if (resource.captionFormat !== "srt" && resource.captionFormat !== "vtt") fail();
    copy.captionFormat = resource.captionFormat;
  }
  if (resource.representation !== undefined) {
    if (resource.kind !== "video" || !isMediaRepresentation(resource.representation)) fail();
    copy.representation = Object.freeze({ etag: resource.representation.etag, length: resource.representation.length });
  }
  return Object.freeze(copy);
}

/**
 * Memory-local capabilities: restarting or evicting invalidates issued tokens.
 * This is NOT SSRF protection: the later transport must enforce approved hosts,
 * public DNS/IP pinning, redirect denial and originating-host header isolation.
 */
export class MemoryMediaRegistry implements MediaRegistry {
  readonly #key: Buffer;
  readonly #ttlMs: number;
  readonly #capacity: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(options: MediaRegistryOptions) {
    if (!options) fail();
    const key = options.signingKey;
    if (typeof key === "string") {
      if (key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) fail();
      this.#key = Buffer.from(key, "hex");
    } else {
      if (!(key instanceof Uint8Array) || key.byteLength < 32 || key.byteLength > 1_024) fail();
      this.#key = Buffer.from(key);
    }
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#capacity = options.capacity ?? 1_024;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0 || this.#ttlMs > MAX_MEDIA_TTL_MS ||
        !Number.isSafeInteger(this.#capacity) || this.#capacity <= 0 || this.#capacity > MAX_CAPACITY ||
        (options.now !== undefined && typeof options.now !== "function")) fail();
    this.#now = options.now ?? Date.now;
  }

  register(resource: MediaResource, expiresAt: number): string {
    const now = timestamp(this.#now());
    const owned = copyResource(resource);
    const expiry = Math.min(timestamp(expiresAt), now + this.#ttlMs,
      owned.expiresAt === undefined ? Infinity : owned.expiresAt - UPSTREAM_EXPIRY_MARGIN_MS);
    if (!Number.isSafeInteger(expiry) || expiry <= now) fail();
    this.#prune(now);
    // FIFO eviction, never allow reads to keep old resources alive indefinitely.
    while (this.#entries.size >= this.#capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    let id: string;
    do { id = randomBytes(24).toString("base64url"); } while (this.#entries.has(id));
    const payload = `v1.${owned.kind}.GET-HEAD.${id}.${expiry}`;
    this.#entries.set(id, { resource: owned, expiresAt: expiry });
    return `${payload}.${this.#signature(payload).toString("base64url")}`;
  }

  registerBatch(resources: readonly MediaResource[], expiresAt: number): { tokens: string[]; expiresAt: number } {
    // Validate every descriptor and generate every capability before touching live entries.
    // A failed generation cannot evict or partially replace committed playback.
    if (!Array.isArray(resources) || resources.length === 0 || resources.length > this.#capacity) fail();
    const now = timestamp(this.#now());
    const owned: MediaResource[] = [];
    let expiry = Math.min(timestamp(expiresAt), now + this.#ttlMs);
    for (const resource of resources) {
      const copy = copyResource(resource);
      owned.push(copy);
      if (copy.expiresAt !== undefined) expiry = Math.min(expiry, copy.expiresAt - UPSTREAM_EXPIRY_MARGIN_MS);
    }
    if (!Number.isSafeInteger(expiry) || expiry <= now) fail();
    this.#prune(now);
    if (this.#entries.size + owned.length > this.#capacity) fail();
    const staged = new Map<string, Entry>();
    const tokens: string[] = [];
    for (const resource of owned) {
      let id: string;
      do { id = randomBytes(24).toString("base64url"); } while (this.#entries.has(id) || staged.has(id));
      const payload = `v1.${resource.kind}.GET-HEAD.${id}.${expiry}`;
      tokens.push(`${payload}.${this.#signature(payload).toString("base64url")}`);
      staged.set(id, { resource, expiresAt: expiry });
    }
    for (const [id, entry] of staged) this.#entries.set(id, entry);
    return { tokens, expiresAt: expiry };
  }

  resolve(token: string, method: string): MediaResource | undefined {
    if (method !== "GET" && method !== "HEAD") return undefined;
    return this.#lookup(token)?.resource;
  }

  /** Verified capability expiry, not the original upstream expiry. */
  expiresAt(token: string): number | undefined {
    return this.#lookup(token)?.expiresAt;
  }

  revoke(token: string): void {
    const match = this.#authenticate(token);
    if (match) this.#entries.delete(match.id);
    this.#prune(timestamp(this.#now()));
  }

  #signature(payload: string): Buffer {
    return createHmac("sha256", this.#key).update(`cine-vault/media-capability\n${payload}`).digest();
  }

  #authenticate(token: string): { id: string; kind: MediaResource["kind"]; expiresAt: number } | undefined {
    if (typeof token !== "string" || token.length > 160) return undefined;
    const match = TOKEN_PATTERN.exec(token);
    if (!match || match[0] !== token) return undefined;
    const [, kind, id, expiryText, signatureText] = match;
    if (!id || !expiryText || !signatureText || !isResourceKind(kind)) return undefined;
    const expiresAt = Number(expiryText);
    if (!Number.isSafeInteger(expiresAt) || String(expiresAt) !== expiryText) return undefined;
    const signature = Buffer.from(signatureText, "base64url");
    // Node's decoder accepts noncanonical padding bits; require exact encoding.
    if (signature.length !== 32 || signature.toString("base64url") !== signatureText) return undefined;
    const payload = token.slice(0, token.lastIndexOf("."));
    if (!timingSafeEqual(signature, this.#signature(payload))) return undefined;
    return { id, kind, expiresAt };
  }

  #lookup(token: string): Entry | undefined {
    const now = timestamp(this.#now());
    this.#prune(now);
    const capability = this.#authenticate(token);
    if (!capability || capability.expiresAt <= now) return undefined;
    const entry = this.#entries.get(capability.id);
    if (!entry || entry.expiresAt !== capability.expiresAt || entry.resource.kind !== capability.kind) return undefined;
    return entry;
  }

  #prune(now: number): void {
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(id);
    }
  }
}

export function createMediaRegistry(options: MediaRegistryOptions): MemoryMediaRegistry {
  return new MemoryMediaRegistry(options);
}
