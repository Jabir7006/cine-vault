import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { convertCaptionToWebVtt } from "./captions.ts";
import type { MediaResource, MediaTransport } from "./types.ts";

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
  const output: Record<string, string> = { "accept-encoding": "identity", accept: resource.kind === "video" ? "video/mp4" : "text/vtt,text/plain" };
  for (const [name, value] of Object.entries(resource.headers)) {
    const key = name.toLowerCase();
    if (!["referer", "user-agent", "cookie"].includes(key) || (key === "cookie" && resource.kind === "subtitle")) continue;
    if (typeof value !== "string" || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value) || key in output) return fail("invalid_resource");
    output[key] = value;
  }
  if (range !== undefined) output.range = range;
  return output;
}
type ResponseMetadata = { status: number; length?: number; headers: Headers };
function header(response: IncomingMessage, key: string): string | undefined {
  const value = response.headers[key];
  if (Array.isArray(value)) return fail("invalid_response");
  return value;
}
function responseNumber(value: string): number {
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) return fail("invalid_response");
  return Number(value);
}
export function validateVideoResponse(response: IncomingMessage, requested?: ByteRange): ResponseMetadata {
  const status = response.statusCode ?? 0;
  if (![200, 206, 416].includes(status)) return fail("invalid_response");
  const encoding = header(response, "content-encoding");
  if (encoding && encoding !== "identity") return fail("invalid_response");
  const lengthHeader = header(response, "content-length");
  let length = lengthHeader === undefined ? undefined : responseNumber(lengthHeader);
  const headers = new Headers({ "content-type": "video/mp4", "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
  const contentRange = header(response, "content-range");
  if (status === 416) {
    if (!requested || !contentRange || !/^bytes \*\/\d+$/.test(contentRange)) return fail("invalid_response");
    const total = responseNumber(contentRange.slice(8));
    if (total > 0 && ("suffix" in requested || requested.start < total)) return fail("invalid_response");
    headers.set("content-range", contentRange);
    headers.set("content-length", "0");
    return { status, length: 0, headers };
  }
  const mime = header(response, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime !== "video/mp4" || (length !== undefined && length === 0)) return fail("invalid_response");
  if (status === 206) {
    const match = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (!requested || !match) return fail("invalid_response");
    const start = responseNumber(match[1]!);
    const end = responseNumber(match[2]!);
    const total = responseNumber(match[3]!);
    if (end < start || total <= end || (length !== undefined && length !== end - start + 1)) return fail("invalid_response");
    length = end - start + 1;
    const expectedStart = "suffix" in requested ? Math.max(0, total - requested.suffix) : requested.start;
    const expectedEnd = "suffix" in requested || requested.end === undefined ? total - 1 : Math.min(requested.end, total - 1);
    if (start !== expectedStart || end !== expectedEnd) return fail("invalid_response");
    headers.set("content-range", contentRange!);
  } else if (contentRange) return fail("invalid_response");
  if (length !== undefined) headers.set("content-length", String(length));
  if (header(response, "accept-ranges") === "bytes") headers.set("accept-ranges", "bytes");
  return { status, length, headers };
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
export class SecureMediaTransport implements MediaTransport {
  private readonly mediaHosts: Set<string>;
  private readonly captionHosts: Set<string>;
  private readonly resolver: NonNullable<TransportOptions["resolver"]>;
  private readonly request: TransportRequest;
  private readonly concurrency: number;
  private active = 0;
  private readonly connectMs: number;
  private readonly headersMs: number;
  private readonly idleMs: number;
  private readonly totalMs: number;
  private readonly probeMs: number;
  private readonly captionMs: number;
  constructor(options: TransportOptions) {
    this.mediaHosts = new Set(options.mediaHosts.map(validateHost));
    this.captionHosts = new Set(options.captionHosts.map(validateHost));
    this.concurrency = bounded(options.concurrency, 8, 16, 4);
    this.connectMs = bounded(options.connectTimeoutMs, 5000, 10000);
    this.headersMs = bounded(options.headersTimeoutMs, 10000, 10000);
    this.idleMs = bounded(options.idleTimeoutMs, 15000, 15000);
    this.totalMs = bounded(options.totalTimeoutMs, 30 * 60 * 1000, 30 * 60 * 1000);
    this.probeMs = bounded(options.probeTimeoutMs, 10000, 10000);
    this.captionMs = bounded(options.captionTimeoutMs, 10000, 10000);
    this.resolver = options.resolver ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
    this.request = options.request ?? httpsRequest;
  }
  private async open(resource: MediaResource, method: "GET" | "HEAD", range: string | undefined, signal: AbortSignal | undefined, deadline: number): Promise<Transfer> {
    if (!["video", "subtitle"].includes(resource.kind)) return fail("invalid_resource");
    const url = validateMediaUrl(resource.url, resource.kind === "video" ? this.mediaHosts : this.captionHosts);
    const headers = resourceHeaders(resource, range);
    if (resource.expiresAt !== undefined && (!Number.isFinite(resource.expiresAt) || resource.expiresAt <= Date.now())) return fail("invalid_resource");
    if (signal?.aborted) return fail("cancelled");
    if (this.active >= this.concurrency) return fail("busy");
    this.active++;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let stopped = false;
    let failure: TransportError | undefined;
    let rejectPending: ((error: TransportError) => void) | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const finish = () => {
      if (stopped) return;
      stopped = true;
      this.active--;
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
    const parsed = validateRange(range);
    const transfer = await this.open(resource, method, range, signal, this.totalMs);
    try {
      const metadata = validateVideoResponse(transfer.response, parsed);
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
  async probe(resource: MediaResource, signal?: AbortSignal): Promise<boolean> {
    if (resource.kind !== "video") return false;
    let transfer: Transfer | undefined;
    try {
      transfer = await this.open(resource, "GET", "bytes=0-4095", signal, this.probeMs);
      const metadata = validateVideoResponse(transfer.response, { start: 0, end: 4095 });
      if (metadata.status === 416) return false;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of transfer.response) {
        if (transfer.error()) throw transfer.error();
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        const part = data.subarray(0, 4096 - length);
        chunks.push(part);
        length += part.length;
        const prefix = Buffer.concat(chunks, length);
        if (prefix.length >= 16) {
          const size = prefix.readUInt32BE(0);
          if (prefix.toString("latin1", 4, 8) !== "ftyp" || size < 16 || size > 4096 || size % 4) return false;
          if (length >= size) return isMp4Prefix(prefix);
        }
        if (length >= 4096) return false;
      }
      if (transfer.error()) throw transfer.error();
      return isMp4Prefix(Buffer.concat(chunks, length));
    } catch (error) {
      const safe = transfer?.error() ?? error;
      if (safe instanceof TransportError && safe.code === "cancelled") throw safe;
      return false;
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
