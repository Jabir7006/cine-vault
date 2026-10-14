import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { convertCaptionToWebVtt } from "./captions.ts";
import { dashAudioRepresentationId, dashDirectory, dashManifestHeights, dashSegmentUrl, DASH_MANIFEST_LIMIT_BYTES, nextDashSegmentNames, rewriteDashManifest } from "./dash.ts";
import { createSegmentStore } from "./dash-segments.ts";
import type { SegmentChunk, SegmentPriority, SegmentStore } from "./dash-segments.ts";
import { isMediaRepresentation, isStrongMediaEtag, mediaProbeFailureCodes } from "./types.ts";
import type { DashManifest, MediaProbeEvidence, MediaProbeFailureCode, MediaRepresentation, MediaResource, MediaTransport } from "./types.ts";

export type TransportErrorCode = "invalid_resource" | "invalid_range" | "blocked_address" | "busy" | "cancelled" | "timeout" | "upstream" | "invalid_response" | "too_large";
export class TransportError extends Error {
  constructor(public readonly code: TransportErrorCode) {
    super(`Media transport ${code.replaceAll("_", " ")}`);
    this.name = "TransportError";
  }
}
const fail = (code: TransportErrorCode): never => { throw new TransportError(code); };
export type Address = { address: string; family: number };
export type TransportRequest = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
export interface TransportOptions {
  mediaHosts: readonly string[];
  captionHosts: readonly string[];
  concurrency?: number;
  /** Range requests in flight across every adaptive stream: video, audio and lookahead share them. */
  segmentConcurrency?: number;
  /** Lookahead may never occupy more than this many slots, so a waiting player always has room. */
  lookaheadReserve?: number;
  /** How long a chunk request that is waiting for a slot waits before giving up. */
  queueTimeoutMs?: number;
  segmentTimeoutMs?: number;
  documentTimeoutMs?: number;
  connectTimeoutMs?: number;
  headersTimeoutMs?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  probeTimeoutMs?: number;
  captionTimeoutMs?: number;
  resolver?: (hostname: string) => Promise<readonly Address[]>;
  request?: TransportRequest;
}
export type ByteRange = { start: number; end?: number } | { suffix: number };
const MAX_BYTE = Number.MAX_SAFE_INTEGER;
const number = (value: string): number => {
  if (!/^\d{1,16}$/.test(value)) return fail("invalid_range");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > MAX_BYTE) return fail("invalid_range");
  return result;
};
export function validateRange(value?: string): ByteRange | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return fail("invalid_range");
  if (!match[1]) {
    const suffix = number(match[2]!);
    if (!suffix) return fail("invalid_range");
    return { suffix };
  }
  const start = number(match[1]);
  const end = match[2] ? number(match[2]) : undefined;
  if (end !== undefined && end < start) return fail("invalid_range");
  return { start, end };
}
function ipv6Number(address: string): bigint {
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}
const inPrefix = (value: bigint, base: bigint, bits: number, size: number) => value >> BigInt(size - bits) === base >> BigInt(size - bits);
/** Conservative globally routable unicast policy; mapped/transition IPv6 is never accepted. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = address.split(".").reduce((n, part) => (n << 8n) | BigInt(part), 0n);
    const denied: [string, number][] = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]];
    return !denied.some(([base, bits]) => inPrefix(value, base.split(".").reduce((n, part) => (n << 8n) | BigInt(part), 0n), bits, 32));
  }
  if (family !== 6 || address.includes(".") || address.includes("%")) return false;
  const value = ipv6Number(address);
  if (!inPrefix(value, ipv6Number("2000::"), 3, 128)) return false;
  return !([["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20]] as const).some(([base, bits]) => inPrefix(value, ipv6Number(base), bits, 128));
}
function validateHost(host: string): string {
  if (typeof host !== "string" || host !== host.toLowerCase() || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || host.split(".").some((part) => part.length > 63) || isIP(host)) return fail("invalid_resource");
  return host;
}
export function validateMediaUrl(value: string, hosts: ReadonlySet<string>): URL {
  if (typeof value !== "string" || /[\x00-\x20\x7f\\]/.test(value)) return fail("invalid_resource");
  let url: URL;
  try { url = new URL(value); } catch { return fail("invalid_resource"); }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || value.includes("#") || /^https:\/\/[^/]*@/i.test(value) || !hosts.has(url.hostname) || isIP(url.hostname.replace(/^\[|\]$/g, ""))) return fail("invalid_resource");
  return url;
}
/** Descriptor headers are server-owned and valid only for this descriptor's exact origin. */
export function resourceHeaders(resource: MediaResource, range?: string): Record<string, string> {
  validateRange(range);
  if (!resource.headers || typeof resource.headers !== "object" || Array.isArray(resource.headers)) return fail("invalid_resource");
  const accept = resource.kind === "video" ? "video/mp4" : resource.kind === "subtitle" ? "text/vtt,text/plain" : "application/dash+xml,application/xml;q=0.9,*/*;q=0.8";
  const output: Record<string, string> = { "accept-encoding": "identity", accept };
  for (const [name, value] of Object.entries(resource.headers)) {
    const key = name.toLowerCase();
    // A manifest carries its authorization in the cookie, so only subtitles never send one.
    if (!["referer", "user-agent", "cookie"].includes(key) || (key === "cookie" && resource.kind === "subtitle")) continue;
    if (typeof value !== "string" || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value) || key in output) return fail("invalid_resource");
    output[key] = value;
  }
  if (resource.representation !== undefined) {
    if (resource.kind !== "video" || !isMediaRepresentation(resource.representation)) return fail("invalid_resource");
    // Never accept conditional authorization/validators through arbitrary headers.
    output["if-match"] = resource.representation.etag;
  }
  if (range !== undefined) output.range = range;
  return output;
}
type ResponseMetadata = { status: number; length?: number; total?: number; headers: Headers };
function header(response: IncomingMessage, key: string): string | undefined {
  const value = response.headers[key];
  if (Array.isArray(value)) return fail("invalid_response");
  return value;
}
function responseNumber(value: string): number {
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) return fail("invalid_response");
  return Number(value);
}
export interface MediaExpectation {
  /** Upstream types that can carry this document; anything else — an HTML refusal page — is refused. */
  upstream: ReadonlySet<string>;
  /** What the relay declares to its own client. */
  output: string;
  /** Ceiling for a whole document, when the caller knows one. */
  limit?: number;
}
const VIDEO_EXPECTATION: MediaExpectation = { upstream: new Set(["video/mp4"]), output: "video/mp4" };
/**
 * The CDN labels its manifest and its media segments `application/octet-stream` and reports a refusal
 * as `text/html` (verified live), so both are listed rather than assumed from the file extension.
 */
const MANIFEST_EXPECTATION: MediaExpectation = {
  upstream: new Set(["application/octet-stream", "binary/octet-stream", "application/dash+xml", "application/xml", "text/xml"]),
  output: "application/dash+xml",
  limit: DASH_MANIFEST_LIMIT_BYTES,
};
const SEGMENT_EXPECTATION: MediaExpectation = {
  upstream: new Set(["application/octet-stream", "binary/octet-stream", "video/mp4", "video/iso.segment", "application/mp4"]),
  output: "video/mp4",
};
export function validateMediaResponse(response: IncomingMessage, requested: ByteRange | undefined, expectation: MediaExpectation): ResponseMetadata {
  const status = response.statusCode ?? 0;
  if (![200, 206, 416].includes(status)) return fail("invalid_response");
  const encoding = header(response, "content-encoding");
  if (encoding && encoding !== "identity") return fail("invalid_response");
  const lengthHeader = header(response, "content-length");
  let length = lengthHeader === undefined ? undefined : responseNumber(lengthHeader);
  let total = length;
  const headers = new Headers({ "content-type": expectation.output, "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
  const contentRange = header(response, "content-range");
  if (status === 416) {
    if (!requested || !contentRange || !/^bytes \*\/\d+$/.test(contentRange)) return fail("invalid_response");
    const unsatisfied = responseNumber(contentRange.slice(8));
    if (unsatisfied > 0 && ("suffix" in requested || requested.start < unsatisfied)) return fail("invalid_response");
    headers.set("content-range", contentRange);
    headers.set("content-length", "0");
    return { status, length: 0, total: unsatisfied, headers };
  }
  const mime = header(response, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === undefined || !expectation.upstream.has(mime) || (length !== undefined && length === 0)) return fail("invalid_response");
  if (status === 206) {
    const match = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (!requested || !match) return fail("invalid_response");
    const start = responseNumber(match[1]!);
    const end = responseNumber(match[2]!);
    total = responseNumber(match[3]!);
    if (end < start || total <= end || (length !== undefined && length !== end - start + 1)) return fail("invalid_response");
    if (expectation.limit !== undefined && total > expectation.limit) return fail("too_large");
    length = end - start + 1;
    const expectedStart = "suffix" in requested ? Math.max(0, total - requested.suffix) : requested.start;
    const expectedEnd = "suffix" in requested || requested.end === undefined ? total - 1 : Math.min(requested.end, total - 1);
    if (start !== expectedStart || end !== expectedEnd) return fail("invalid_response");
    headers.set("content-range", contentRange!);
  } else {
    if (contentRange) return fail("invalid_response");
    if (expectation.limit !== undefined && (length ?? 0) > expectation.limit) return fail("too_large");
  }
  if (length !== undefined) headers.set("content-length", String(length));
  if (header(response, "accept-ranges") === "bytes") headers.set("accept-ranges", "bytes");
  return { status, length, total, headers };
}
export function validateVideoResponse(response: IncomingMessage, requested?: ByteRange): ResponseMetadata {
  return validateMediaResponse(response, requested, VIDEO_EXPECTATION);
}
function responseRepresentation(response: IncomingMessage, metadata: ResponseMetadata): MediaRepresentation | undefined {
  // A malformed/weak/missing ETag does not invalidate an otherwise eligible MP4.
  // Do not promote duplicated validators (including synthetic header arrays).
  const etag = response.headers.etag;
  let originalEtagCount = 0;
  const rawHeaders = response.rawHeaders ?? [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "etag") {
      originalEtagCount++;
      if (rawHeaders[index + 1] !== etag) return undefined;
    }
  }
  if (originalEtagCount > 1 || !isStrongMediaEtag(etag) || metadata.total === undefined || metadata.total <= 0) return undefined;
  return { etag, length: metadata.total };
}
function bindRepresentation(resource: MediaResource): MediaResource {
  if (resource.representation === undefined) return resource;
  if (resource.kind !== "video" || !isMediaRepresentation(resource.representation)) return fail("invalid_resource");
  // Snapshot before DNS/headers awaits: caller mutation must not weaken the condition.
  return { ...resource, representation: Object.freeze({ etag: resource.representation.etag, length: resource.representation.length }) };
}
function validateRepresentation(response: IncomingMessage, metadata: ResponseMetadata, expected?: MediaRepresentation): MediaRepresentation | undefined {
  const actual = responseRepresentation(response, metadata);
  if (expected !== undefined && (!isMediaRepresentation(expected) || !actual ||
      actual.etag !== expected.etag || actual.length !== expected.length)) return fail("invalid_response");
  return actual;
}
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP"]);
export function isMp4Prefix(bytes: Uint8Array): boolean {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 16 || data.toString("latin1", 4, 8) !== "ftyp") return false;
  const size = data.readUInt32BE(0);
  if (size < 16 || size > 4096 || size % 4 || size > data.length) return false;
  if (MP4_BRANDS.has(data.toString("latin1", 8, 12))) return true;
  for (let offset = 16; offset < size; offset += 4) if (MP4_BRANDS.has(data.toString("latin1", offset, offset + 4))) return true;
  return false;
}
function bounded(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) return fail("invalid_resource");
  return result;
}
type Transfer = { response: IncomingMessage; finish: () => void; stop: (error?: TransportError) => void; error: () => TransportError | undefined };
/**
 * Which queue a transfer draws its slot from.
 *
 * `client` is a request a caller is waiting on and is refused outright when the transport is full.
 * `segment` and `lookahead` share one much larger pool, because one adaptive segment is assembled
 * from many range requests at once: a player-facing chunk waits for a slot, while lookahead only ever
 * takes what is left above the reserve, so it can never stall playback and never half-fills a segment
 * it will have to throw away.
 */
type Lane = "client" | "segment" | "lookahead";
type Budget = { active: number; limit: number; reserve: number; waiters: (() => void)[] };
export class SecureMediaTransport implements MediaTransport {
  private readonly mediaHosts: Set<string>;
  private readonly captionHosts: Set<string>;
  private readonly resolver: NonNullable<TransportOptions["resolver"]>;
  private readonly request: TransportRequest;
  private readonly budgets: Record<"client" | "segment", Budget>;
  private readonly queueMs: number;
  private readonly connectMs: number;
  private readonly headersMs: number;
  private readonly idleMs: number;
  private readonly totalMs: number;
  private readonly probeMs: number;
  private readonly captionMs: number;
  private readonly segmentMs: number;
  private readonly documentMs: number;
  private readonly segments: SegmentStore;
  /** Credentials per signed stream, keyed by the manifest's directory: segments carry no token of their own. */
  private readonly streams = new Map<string, { resource: MediaResource; audioRepresentationId?: string }>();
  constructor(options: TransportOptions) {
    this.mediaHosts = new Set(options.mediaHosts.map(validateHost));
    this.captionHosts = new Set(options.captionHosts.map(validateHost));
    const segmentLimit = bounded(options.segmentConcurrency, 16, 24, 4);
    this.budgets = {
      client: { active: 0, limit: bounded(options.concurrency, 8, 16, 4), reserve: 0, waiters: [] },
      segment: { active: 0, limit: segmentLimit, reserve: bounded(options.lookaheadReserve, 4, segmentLimit - 1, 1), waiters: [] },
    };
    this.queueMs = bounded(options.queueTimeoutMs, 20000, 60000);
    this.connectMs = bounded(options.connectTimeoutMs, 5000, 10000);
    this.headersMs = bounded(options.headersTimeoutMs, 10000, 10000);
    this.idleMs = bounded(options.idleTimeoutMs, 15000, 15000);
    this.totalMs = bounded(options.totalTimeoutMs, 30 * 60 * 1000, 30 * 60 * 1000);
    this.probeMs = bounded(options.probeTimeoutMs, 10000, 10000);
    this.captionMs = bounded(options.captionTimeoutMs, 10000, 10000);
    // A 95KB chunk at the throttled floor measured against this CDN (~1 Mbit/s) takes under a second.
    this.segmentMs = bounded(options.segmentTimeoutMs, 30000, 120000);
    this.documentMs = bounded(options.documentTimeoutMs, 20000, 60000);
    this.resolver = options.resolver ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
    this.request = options.request ?? httpsRequest;
    this.segments = createSegmentStore({
      chunkBytes: 95 * 1024,
      concurrency: segmentLimit,
      // Lookahead stays narrow enough that every lookahead assembly fits in the unreserved capacity.
      prefetchChunkConcurrency: Math.max(1, Math.floor((segmentLimit - this.budgets.segment.reserve) / 3)),
      maxSegmentBytes: 32 * 1024 * 1024,
      fetchChunk: (url, range, priority, signal) => this.fetchSegmentChunk(url, range, priority, signal),
    });
  }
  /** Wait outside the transport's own transfer budget, bounded by both a slot freeing and a deadline. */
  private async awaitSlot(budget: Budget, capacity: number, signal: AbortSignal | undefined): Promise<void> {
    const deadline = Date.now() + this.queueMs;
    while (budget.active >= capacity) {
      if (signal?.aborted) return fail("cancelled");
      if (Date.now() >= deadline) return fail("busy");
      await new Promise<void>((resolve) => {
        let settled = false;
        const wake = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", wake);
          budget.waiters = budget.waiters.filter((entry) => entry !== wake);
          resolve();
        };
        const timer = setTimeout(wake, 25);
        budget.waiters.push(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
  }
  private async open(resource: MediaResource, method: "GET" | "HEAD", range: string | undefined, signal: AbortSignal | undefined, deadline: number, lane: Lane = "client"): Promise<Transfer> {
    if (!["video", "subtitle", "manifest"].includes(resource.kind)) return fail("invalid_resource");
    const url = validateMediaUrl(resource.url, resource.kind === "subtitle" ? this.captionHosts : this.mediaHosts);
    const headers = resourceHeaders(resource, range);
    if (resource.expiresAt !== undefined && (!Number.isFinite(resource.expiresAt) || resource.expiresAt <= Date.now())) return fail("invalid_resource");
    if (signal?.aborted) return fail("cancelled");
    const budget = lane === "client" ? this.budgets.client : this.budgets.segment;
    const capacity = lane === "lookahead" ? budget.limit - budget.reserve : budget.limit;
    if (budget.active >= capacity) {
      if (lane !== "segment") return fail("busy");
      await this.awaitSlot(budget, capacity, signal);
    }
    budget.active++;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let stopped = false;
    let failure: TransportError | undefined;
    let rejectPending: ((error: TransportError) => void) | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const finish = () => {
      if (stopped) return;
      stopped = true;
      budget.active--;
      for (const wake of budget.waiters.splice(0)) wake();
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const stop = (error?: TransportError) => {
      if (stopped) return;
      failure = error;
      finish();
      // No upstream errors (which may contain signed URLs) escape to callers.
      response?.destroy();
      request?.destroy();
      rejectPending?.(error ?? new TransportError("cancelled"));
    };
    const abort = () => stop(new TransportError("cancelled"));
    const timer = (ms: number) => {
      const id = setTimeout(() => stop(new TransportError("timeout")), ms);
      timers.add(id);
      return id;
    };
    signal?.addEventListener("abort", abort, { once: true });
    timer(Math.min(deadline, this.totalMs));
    const headersTimer = timer(this.headersMs);
    try {
      const addresses = await new Promise<readonly Address[]>((resolve, reject) => {
        rejectPending = reject;
        this.resolver(url.hostname).then(resolve, () => reject(new TransportError("upstream")));
      });
      if (stopped) throw failure ?? new TransportError("cancelled");
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) return fail("blocked_address");
      const selected = addresses[0]!;
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        rejectPending = reject;
        const connectTimer = timer(this.connectMs);
        request = this.request(url, {
          method, headers, agent: false, servername: url.hostname, family: selected.family,
          // Keep the original hostname for SNI/default certificate verification, pin DNS only.
          lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        }, (incoming) => {
          response = incoming;
          incoming.on("error", () => stop(new TransportError("upstream")));
          incoming.on("aborted", () => stop(new TransportError("upstream")));
          incoming.pause();
          clearTimeout(connectTimer);
          clearTimeout(headersTimer);
          if (stopped) { incoming.destroy(); return; }
          incoming.setTimeout(this.idleMs, () => stop(new TransportError("timeout")));
          resolve(incoming);
        });
        request.on("socket", (socket) => socket.once("secureConnect", () => clearTimeout(connectTimer)));
        request.on("error", () => stop(new TransportError("upstream")));
        request.end();
      });
      if (stopped) throw failure ?? new TransportError("cancelled");
      rejectPending = undefined;
      return { response, finish, stop, error: () => failure };
    } catch (error) {
      const safe = error instanceof TransportError ? error : new TransportError("upstream");
      stop(safe);
      throw safe;
    }
  }
  async relay(resource: MediaResource, method: "GET" | "HEAD", range?: string, signal?: AbortSignal): Promise<Response> {
    if (resource.kind !== "video" || !["GET", "HEAD"].includes(method)) return fail("invalid_resource");
    resource = bindRepresentation(resource);
    const parsed = validateRange(range);
    const transfer = await this.open(resource, method, range, signal, this.totalMs);
    try {
      const metadata = validateVideoResponse(transfer.response, parsed);
      validateRepresentation(transfer.response, metadata, resource.representation);
      if (method === "HEAD" || metadata.status === 416) {
        transfer.stop();
        return new Response(null, { status: metadata.status, headers: metadata.headers });
      }
      const iterator = transfer.response[Symbol.asyncIterator]();
      let received = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (transfer.error()) throw transfer.error();
            const next = await iterator.next();
            if (transfer.error()) throw transfer.error();
            if (next.done) {
              if (metadata.length !== undefined && received !== metadata.length) throw new TransportError("invalid_response");
              transfer.finish();
              controller.close();
              return;
            }
            const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
            received += chunk.length;
            if (metadata.length !== undefined && received > metadata.length) throw new TransportError("invalid_response");
            controller.enqueue(chunk);
          } catch (error) {
            const safe = transfer.error() ?? (error instanceof TransportError ? error : new TransportError("upstream"));
            transfer.stop(safe);
            controller.error(safe);
          }
        },
        cancel() { transfer.stop(new TransportError("cancelled")); },
      }, { highWaterMark: 0 });
      return new Response(body, { status: metadata.status, headers: metadata.headers });
    } catch (error) {
      const safe = error instanceof TransportError ? error : new TransportError("invalid_response");
      transfer.stop(safe);
      throw safe;
    }
  }
  /** Read a small document whole, with a hard ceiling and a verified length. */
  private async readDocument(resource: MediaResource, expectation: MediaExpectation, deadline: number, signal?: AbortSignal): Promise<Buffer> {
    const transfer = await this.open(resource, "GET", undefined, signal, deadline);
    try {
      const metadata = validateMediaResponse(transfer.response, undefined, expectation);
      if (metadata.status !== 200) return fail("invalid_response");
      const limit = expectation.limit ?? metadata.length ?? 32 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const data of transfer.response) {
        if (transfer.error()) throw transfer.error();
        length += data.length;
        if (length > limit) return fail("too_large");
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array));
      }
      if (transfer.error()) throw transfer.error();
      if (metadata.length !== undefined && length !== metadata.length) return fail("invalid_response");
      return Buffer.concat(chunks, length);
    } catch (error) {
      throw transfer.error() ?? (error instanceof TransportError ? error : new TransportError("invalid_response"));
    } finally { transfer.stop(); }
  }
  /**
   * Read the signed adaptive manifest behind a stream and remember its credentials.
   *
   * A DASH manifest carries no token of its own: every segment lives in the same directory as the
   * manifest and is authorized by the same cookie, so the descriptor read here is what the segment
   * relay later sends. Registering it is also what makes a segment request possible at all — an
   * unknown directory is refused rather than fetched with no credentials.
   */
  async readManifest(resource: MediaResource, signal?: AbortSignal): Promise<DashManifest> {
    if (resource.kind !== "manifest") return fail("invalid_resource");
    const directory = dashDirectory(resource.url);
    if (directory === undefined) return fail("invalid_resource");
    const body = await this.readDocument(resource, MANIFEST_EXPECTATION, this.documentMs, signal);
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(body);
    // An MPEG-DASH manifest is the only thing this route may ever hand back.
    if (!/<MPD\b/.test(xml.slice(0, 4096))) return fail("invalid_response");
    const audioRepresentationId = dashAudioRepresentationId(xml);
    this.streams.delete(directory);
    this.streams.set(directory, { resource, ...(audioRepresentationId === undefined ? {} : { audioRepresentationId }) });
    // Bounded: a stream descriptor is worthless once its authorization has expired anyway.
    while (this.streams.size > 16) {
      const oldest = this.streams.keys().next().value;
      if (oldest === undefined) break;
      this.streams.delete(oldest);
    }
    return { xml, heights: dashManifestHeights(xml), ...(audioRepresentationId === undefined ? {} : { audioRepresentationId }) };
  }
  /**
   * Serve the manifest with its absolute references pointed back at this relay.
   *
   * The API's templates are relative (`chunk-stream$RepresentationID$-$Number%05d$.m4s`), so serving
   * the document from `<publicBase>index.mpd` is what brings every segment back here.
   */
  async relayManifest(resource: MediaResource, publicBase: string, method: "GET" | "HEAD", signal?: AbortSignal): Promise<Response> {
    if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*\/$/.test(publicBase) || publicBase.includes("//") || publicBase.includes("..")) return fail("invalid_resource");
    const manifest = await this.readManifest(resource, signal);
    const body = Buffer.from(rewriteDashManifest(manifest.xml, resource.url, publicBase), "utf8");
    const headers = { "content-type": "application/dash+xml", "content-length": String(body.byteLength), "x-content-type-options": "nosniff", "cache-control": "private, no-store" };
    return method === "HEAD" ? new Response(null, { headers }) : new Response(body, { headers });
  }
  /** The remembered credentials for whichever signed stream a segment URL belongs to. */
  private streamFor(url: string): { resource: MediaResource; audioRepresentationId?: string } | undefined {
    let found: { resource: MediaResource; audioRepresentationId?: string } | undefined;
    let longest = -1;
    for (const [directory, entry] of this.streams) {
      if (url.startsWith(directory) && directory.length > longest) {
        longest = directory.length;
        found = entry;
      }
    }
    return found;
  }
  private async fetchSegmentChunk(url: string, range: string, priority: SegmentPriority, signal?: AbortSignal): Promise<SegmentChunk> {
    const entry = this.streamFor(url);
    if (entry === undefined) return fail("invalid_resource");
    const requested = validateRange(range);
    if (requested === undefined || "suffix" in requested) return fail("invalid_range");
    const stream: MediaResource = { ...entry.resource, url };
    const transfer = await this.open(stream, "GET", range, signal, this.segmentMs, priority === "prefetch" ? "lookahead" : "segment");
    try {
      const metadata = validateMediaResponse(transfer.response, requested, SEGMENT_EXPECTATION);
      if (metadata.status === 416) return { status: 416, contentType: "text/plain", body: Buffer.alloc(0) };
      const ceiling = metadata.length ?? 32 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const data of transfer.response) {
        if (transfer.error()) throw transfer.error();
        length += data.length;
        if (length > ceiling) return fail("invalid_response");
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array));
      }
      if (transfer.error()) throw transfer.error();
      if (metadata.length !== undefined && length !== metadata.length) return fail("invalid_response");
      return { status: metadata.status, contentType: SEGMENT_EXPECTATION.output, body: Buffer.concat(chunks, length), total: metadata.total };
    } catch (error) {
      throw transfer.error() ?? (error instanceof TransportError ? error : new TransportError("upstream"));
    } finally { transfer.stop(); }
  }
  /**
   * Serve one segment of a signed stream, assembled from many range requests.
   *
   * A whole-segment request against this CDN is throttled to roughly a fifth of the video's own
   * bitrate, so the store fetches it in parallel 95KB ranges; the finished segment is kept, which is
   * what makes a seek back, a retry and the audio/video pairing cheap. Lookahead is started after the
   * player's own segment is in flight, never before it.
   */
  async relaySegment(resource: MediaResource, name: string, range: string | undefined, signal?: AbortSignal): Promise<Response> {
    if (resource.kind !== "manifest") return fail("invalid_resource");
    const url = dashSegmentUrl(resource.url, name);
    if (url === undefined) return fail("invalid_resource");
    const requested = validateRange(range);
    const entry = this.streamFor(url);
    // The client's abort is deliberately not forwarded: segment bytes are shared with lookahead and
    // with any other reader of the same stream, so a player that goes away must not cancel a transfer
    // that somebody else — including this same player a moment later — is about to want.
    const pending = this.segments.get(url);
    const directory = dashDirectory(url);
    if (entry?.audioRepresentationId !== undefined && directory !== undefined) {
      const ahead = nextDashSegmentNames(name, 2, entry.audioRepresentationId);
      if (ahead.length) this.segments.prefetch(ahead.map((next) => `${directory}${next}`));
    }
    const segment = await pending;
    if (segment.status !== 200) {
      return new Response(segment.body, { status: segment.status >= 400 && segment.status <= 599 ? segment.status : 502, headers: { "content-type": "text/plain", "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
    }
    const body = segment.body;
    const length = body.byteLength;
    const common = { "content-type": "video/mp4", "x-content-type-options": "nosniff", "cache-control": "private, no-store", "accept-ranges": "bytes" };
    if (requested === undefined) return new Response(body, { status: 200, headers: { ...common, "content-length": String(length) } });
    const start = "suffix" in requested ? Math.max(0, length - requested.suffix) : requested.start;
    const end = "suffix" in requested ? length - 1 : Math.min(requested.end ?? length - 1, length - 1);
    if (start >= length || end < start) return new Response(null, { status: 416, headers: { ...common, "content-range": `bytes */${length}` } });
    return new Response(body.subarray(start, end + 1), { status: 206, headers: { ...common, "content-range": `bytes ${start}-${end}/${length}`, "content-length": String(end - start + 1) } });
  }
  async probe(resource: MediaResource, signal?: AbortSignal): Promise<boolean> {
    return (await this.probeEvidence(resource, signal)).playable;
  }
  async probeEvidence(resource: MediaResource, signal?: AbortSignal): Promise<MediaProbeEvidence> {
    let transfer: Transfer | undefined;
    const rejected = (code: MediaProbeFailureCode): MediaProbeEvidence => {
      const status = transfer?.response.statusCode;
      const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
      return { playable: false, failure: { code, ...(httpStatus === undefined ? {} : { httpStatus }) } };
    };
    if (resource.kind !== "video") return rejected("invalid_resource");
    try {
      resource = bindRepresentation(resource);
      transfer = await this.open(resource, "GET", "bytes=0-4095", signal, this.probeMs);
      const metadata = validateVideoResponse(transfer.response, { start: 0, end: 4095 });
      if (metadata.status === 416) return rejected("range_unsatisfied");
      const representation = validateRepresentation(transfer.response, metadata, resource.representation);
      const evidence = (prefix: Buffer): MediaProbeEvidence => {
        if (!isMp4Prefix(prefix)) return rejected("invalid_container");
        return representation ? { playable: true, representation } : { playable: true };
      };
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of transfer.response) {
        if (transfer.error()) throw transfer.error();
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        if (metadata.length !== undefined && data.length > metadata.length - length) return rejected("invalid_response");
        const part = data.subarray(0, 4096 - length);
        chunks.push(part);
        length += part.length;
        const prefix = Buffer.concat(chunks, length);
        if (prefix.length >= 16) {
          const size = prefix.readUInt32BE(0);
          if (prefix.toString("latin1", 4, 8) !== "ftyp" || size < 16 || size > 4096 || size % 4) return rejected("invalid_container");
          if (length >= size) return evidence(prefix);
        }
        if (length >= 4096) return rejected("invalid_container");
      }
      if (transfer.error()) throw transfer.error();
      return evidence(Buffer.concat(chunks, length));
    } catch (error) {
      const safe = transfer?.error() ?? error;
      if (safe instanceof TransportError && safe.code === "cancelled") throw safe;
      return rejected(safe instanceof TransportError && mediaProbeFailureCodes.includes(safe.code) ? safe.code : "unknown");
    } finally { transfer?.stop(); }
  }
  async caption(resource: MediaResource, signal?: AbortSignal): Promise<string> {
    if (resource.kind !== "subtitle") return fail("invalid_resource");
    const transfer = await this.open(resource, "GET", undefined, signal, this.captionMs);
    try {
      if (transfer.response.statusCode !== 200) return fail("invalid_response");
      const encoding = header(transfer.response, "content-encoding");
      if (encoding && encoding !== "identity") return fail("invalid_response");
      const contentType = header(transfer.response, "content-type")?.toLowerCase();
      if (contentType && !/^(?:text\/(?:vtt|plain)|application\/(?:x-subrip|octet-stream))(?:\s*;|$)/.test(contentType)) return fail("invalid_response");
      if (contentType && /charset\s*=/.test(contentType) && !/charset\s*=\s*["']?utf-8["']?(?:\s*;|\s*$)/.test(contentType)) return fail("invalid_response");
      const rawLength = header(transfer.response, "content-length");
      const expected = rawLength === undefined ? undefined : responseNumber(rawLength);
      if (expected !== undefined && expected > 512 * 1024) return fail("too_large");
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of transfer.response) {
        if (transfer.error()) throw transfer.error();
        const part = Buffer.from(chunk as Uint8Array);
        length += part.length;
        if (length > 512 * 1024) return fail("too_large");
        chunks.push(part);
      }
      if (transfer.error()) throw transfer.error();
      if (expected !== undefined && length !== expected) return fail("invalid_response");
      const bytes = Buffer.concat(chunks, length);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const format = resource.captionFormat ?? (text.startsWith("WEBVTT") ? "vtt" : "srt");
      return convertCaptionToWebVtt(bytes, format);
    } catch (error) {
      throw transfer.error() ?? (error instanceof TransportError ? error : new TransportError("invalid_response"));
    } finally { transfer.stop(); }
  }
}
