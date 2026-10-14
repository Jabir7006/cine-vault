/**
 * Bounded, shared cache for DASH segments.
 *
 * A player asks for one segment at a time, but a single request against this CDN is throttled far below
 * a video bitrate: measured 0.5 Mbit/s for a whole 5MB segment against ~24 Mbit/s for parallel 95KB
 * range requests over the same connection. Each segment is therefore assembled from many concurrent
 * range requests, and the result is shared — the video and audio of one moment, a retry, and a second
 * viewer of the same title all want bytes that are already in flight or already held.
 *
 * Admission is bounded in both directions: requests in flight, and bytes retained. Nothing here
 * validates a URL, a host or a header; the caller's fetcher owns that and reports what it saw.
 */

export interface SegmentChunk {
  /** The upstream's own status. Only 200 and 206 can carry an assembled segment. */
  status: number;
  contentType?: string;
  body: Buffer;
  /** Complete segment length when the upstream reported one: a content range's total, or a whole body. */
  total?: number;
}
/** `priority` keeps lookahead from competing with the segment a player is waiting for. */
export type SegmentPriority = "foreground" | "prefetch";
export type SegmentChunkFetcher = (url: string, range: string, priority: SegmentPriority, signal?: AbortSignal) => Promise<SegmentChunk>;
export interface SegmentBytes {
  status: number;
  contentType: string;
  body: Buffer;
}
export interface SegmentStoreOptions {
  fetchChunk: SegmentChunkFetcher;
  /** Range-request size: larger wastes throttled transfer, smaller multiplies request overhead. */
  chunkBytes?: number;
  /** Range requests in flight for one segment. */
  concurrency?: number;
  maxSegments?: number;
  maxBytes?: number;
  maxSegmentBytes?: number;
  /** Segments to keep fetching ahead, and how many of those run at once. */
  prefetchDepth?: number;
  prefetchConcurrency?: number;
  /**
   * Range requests in flight for one lookahead segment. Lookahead must stay narrow: it shares the
   * relay's transfer budget with whatever a player is waiting for, and a lookahead assembly that is
   * refused a slot half-way through is dropped, wasting everything it had already fetched.
   */
  prefetchChunkConcurrency?: number;
}
export interface SegmentStore {
  /** A complete segment, or the upstream's own refusal. Never a partial body. */
  get(url: string, signal?: AbortSignal): Promise<SegmentBytes>;
  /** Fetch ahead of the caller. Best effort: refused, oversized and failed segments are dropped. */
  prefetch(urls: readonly string[]): void;
}
export class SegmentError extends Error {
  constructor(readonly code: "too_large" | "invalid_response") { super(`Media segment ${code.replaceAll("_", " ")}`); }
}

const DEFAULT_CHUNK_BYTES = 95 * 1024;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_MAX_SEGMENTS = 12;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_SEGMENT_BYTES = 24 * 1024 * 1024;
const MAX_CONCURRENCY = 24;

const bounded = (value: number | undefined, fallback: number, maximum: number, minimum = 1): number => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error("Invalid segment store configuration");
  return result;
};

export function createSegmentStore(options: SegmentStoreOptions): SegmentStore {
  const fetchChunk = options.fetchChunk;
  const chunkBytes = bounded(options.chunkBytes, DEFAULT_CHUNK_BYTES, 4 * 1024 * 1024, 4 * 1024);
  const concurrency = bounded(options.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
  const maxSegments = bounded(options.maxSegments, DEFAULT_MAX_SEGMENTS, 64);
  const maxBytes = bounded(options.maxBytes, DEFAULT_MAX_BYTES, 512 * 1024 * 1024, 4 * 1024);
  const maxSegmentBytes = bounded(options.maxSegmentBytes, DEFAULT_MAX_SEGMENT_BYTES, 256 * 1024 * 1024, 4 * 1024);
  const prefetchDepth = bounded(options.prefetchDepth, 2, 4);
  const prefetchConcurrency = bounded(options.prefetchConcurrency, 3, 8);
  const prefetchChunkConcurrency = bounded(options.prefetchChunkConcurrency, Math.min(4, concurrency), concurrency);

  // Insertion order is recency: a hit re-inserts, so the oldest key is the least recently used.
  const held = new Map<string, { contentType: string; body: Buffer }>();
  const inFlight = new Map<string, Promise<SegmentBytes>>();
  let heldBytes = 0;
  let prefetching = 0;

  const retain = (url: string, contentType: string, body: Buffer): void => {
    if (!body.byteLength || body.byteLength > maxSegmentBytes) return;
    const previous = held.get(url);
    if (previous) heldBytes -= previous.body.byteLength;
    held.delete(url);
    held.set(url, { contentType, body });
    heldBytes += body.byteLength;
    while (held.size > maxSegments || (heldBytes > maxBytes && held.size > 1)) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      heldBytes -= held.get(oldest)!.body.byteLength;
      held.delete(oldest);
    }
  };

  /**
   * Every byte of one fixed window, however many requests the upstream takes to hand them over.
   *
   * Windows are fixed rather than advanced by "the chunk I asked for", because an upstream may answer
   * with fewer bytes than were requested; a window that is filled from its own received length keeps a
   * short answer from shifting every byte after it. A whole body or a refusal cannot be placed inside a
   * window, and a window that does not end up exactly full means the assembly does not line up.
   */
  const fillWindow = async (url: string, start: number, end: number, priority: SegmentPriority, signal?: AbortSignal): Promise<Buffer> => {
    const parts: Buffer[] = [];
    for (let cursor = start; cursor <= end;) {
      const chunk = await fetchChunk(url, `bytes=${cursor}-${end}`, priority, signal);
      if (chunk.status !== 206 || !chunk.body.byteLength) throw new SegmentError("invalid_response");
      parts.push(chunk.body);
      cursor += chunk.body.byteLength;
    }
    const body = Buffer.concat(parts);
    if (body.byteLength !== end - start + 1) throw new SegmentError("invalid_response");
    return body;
  };

  const assemble = async (url: string, priority: SegmentPriority, signal?: AbortSignal): Promise<SegmentBytes> => {
    const first = await fetchChunk(url, `bytes=0-${chunkBytes - 1}`, priority, signal);
    // A refusal is the upstream's answer to report, not an assembly problem to interpret.
    if (first.status !== 200 && first.status !== 206) return { status: first.status, contentType: first.contentType ?? "", body: first.body };
    const contentType = first.contentType ?? "application/octet-stream";
    if (first.status === 200) {
      // The range was ignored and the whole segment arrived at once.
      if (!first.body.byteLength) throw new SegmentError("invalid_response");
      if (first.body.byteLength > maxSegmentBytes) throw new SegmentError("too_large");
      retain(url, contentType, first.body);
      return { status: 200, contentType, body: first.body };
    }
    const total = first.total;
    if (total === undefined || !Number.isSafeInteger(total) || total <= 0) throw new SegmentError("invalid_response");
    if (total > maxSegmentBytes) throw new SegmentError("too_large");
    if (first.body.byteLength >= total) {
      const body = first.body.subarray(0, total);
      retain(url, contentType, body);
      return { status: 200, contentType, body };
    }
    const windows: [number, number][] = [];
    for (let start = first.body.byteLength; start < total; start += chunkBytes) windows.push([start, Math.min(start + chunkBytes - 1, total - 1)]);
    const parts: Buffer[] = [first.body];
    let assembled = first.body.byteLength;
    const width = priority === "prefetch" ? prefetchChunkConcurrency : concurrency;
    for (let index = 0; index < windows.length; index += width) {
      const batch = await Promise.all(windows.slice(index, index + width).map(([start, end]) => fillWindow(url, start, end, priority, signal)));
      for (const part of batch) {
        parts.push(part);
        assembled += part.byteLength;
      }
    }
    // A short or overlong answer would truncate a segment silently, so the length is verified.
    if (assembled !== total) throw new SegmentError("invalid_response");
    const body = Buffer.concat(parts, assembled);
    retain(url, contentType, body);
    return { status: 200, contentType, body };
  };

  const run = async (url: string, priority: SegmentPriority, signal?: AbortSignal): Promise<SegmentBytes> => {
    const cached = held.get(url);
    if (cached) {
      held.delete(url);
      held.set(url, cached);
      return { status: 200, contentType: cached.contentType, body: cached.body };
    }
    // One assembly per URL: a lookahead already under way is also the answer for a player that asks
    // for that segment, and neither can fetch it twice.
    const running = inFlight.get(url);
    if (running) return running;
    const flight = assemble(url, priority, signal).finally(() => { if (inFlight.get(url) === flight) inFlight.delete(url); });
    inFlight.set(url, flight);
    return flight;
  };

  return {
    get: (url, signal) => run(url, "foreground", signal),
    prefetch(urls) {
      let started = 0;
      for (const url of urls) {
        if (started >= prefetchDepth || prefetching >= prefetchConcurrency) break;
        if (held.has(url) || inFlight.has(url)) continue;
        started++;
        prefetching++;
        void run(url, "prefetch").catch(() => undefined).finally(() => { prefetching--; });
      }
    },
  };
}
