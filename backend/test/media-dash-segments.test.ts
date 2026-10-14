import assert from "node:assert/strict";
import test from "node:test";
import { createSegmentStore, SegmentError } from "../src/media/dash-segments.ts";
import type { SegmentChunkFetcher } from "../src/media/dash-segments.ts";

const chunk = (size: number) => Buffer.alloc(size, 7).map((_value, index) => index % 251) as Buffer;
/** A range-honouring segment backend whose per-request behaviour can be made pathological. */
const backend = (payload: Buffer, options: { ignoreRange?: boolean; short?: number; status?: number } = {}) => {
  const calls: string[] = [];
  const fetchChunk: SegmentChunkFetcher = async (_url, range) => {
    calls.push(range);
    if (options.status !== undefined) return { status: options.status, contentType: "text/plain", body: Buffer.from("refused") };
    if (options.ignoreRange) return { status: 200, contentType: "video/iso.segment", body: payload, total: payload.byteLength };
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), payload.byteLength - 1);
    if (start >= payload.byteLength) return { status: 416, contentType: "video/iso.segment", body: Buffer.alloc(0) };
    // The CDN is free to answer with fewer bytes than were asked for; assembly follows the bytes.
    const stop = options.short === undefined ? end : Math.min(end, start + options.short - 1);
    return { status: 206, contentType: "video/iso.segment", body: payload.subarray(start, stop + 1), total: payload.byteLength };
  };
  return { fetchChunk, calls };
};

test("a segment is assembled from bounded range requests and then served from memory", async () => {
  const payload = chunk(250 * 1024);
  const source = backend(payload);
  const store = createSegmentStore({ fetchChunk: source.fetchChunk, chunkBytes: 100 * 1024, concurrency: 4 });
  const url = "https://sbcdn3.example.test/dash/1/chunk-stream0-00001.m4s";
  const first = await store.get(url);
  assert.equal(first.status, 200);
  assert.equal(first.contentType, "video/iso.segment");
  assert.deepEqual(first.body, payload);
  assert.deepEqual(source.calls, ["bytes=0-102399", "bytes=102400-204799", "bytes=204800-255999"]);
  // A second read of the same segment never touches the network again.
  const second = await store.get(url);
  assert.deepEqual(second.body, payload);
  assert.equal(source.calls.length, 3);
});

test("concurrent readers of one segment share a single assembly", async () => {
  const payload = chunk(300 * 1024);
  const source = backend(payload);
  const store = createSegmentStore({ fetchChunk: source.fetchChunk, chunkBytes: 100 * 1024, concurrency: 4 });
  const url = "https://sbcdn3.example.test/dash/1/chunk-stream1-00002.m4s";
  const results = await Promise.all([store.get(url), store.get(url), store.get(url)]);
  for (const result of results) assert.deepEqual(result.body, payload);
  assert.deepEqual(source.calls, ["bytes=0-102399", "bytes=102400-204799", "bytes=204800-307199"]);
});

test("short range answers are still assembled without gaps or duplication", async () => {
  const payload = chunk(200 * 1024);
  const source = backend(payload, { short: 30 * 1024 });
  const store = createSegmentStore({ fetchChunk: source.fetchChunk, chunkBytes: 100 * 1024, concurrency: 3 });
  const result = await store.get("https://sbcdn3.example.test/dash/1/chunk-stream0-00003.m4s");
  assert.deepEqual(result.body, payload);
  // Every byte is accounted for, so the request starts follow the bytes actually received.
  assert.equal(source.calls[0], "bytes=0-102399");
  assert.ok(source.calls.length >= 7, String(source.calls.length));
  assert.equal(source.calls.at(-1)!.startsWith("bytes="), true);
});

test("a range-ignoring upstream and a single-request segment both work", async () => {
  const payload = chunk(64 * 1024);
  const ignored = backend(payload, { ignoreRange: true });
  const store = createSegmentStore({ fetchChunk: ignored.fetchChunk, chunkBytes: 100 * 1024 });
  assert.deepEqual((await store.get("https://sbcdn3.example.test/dash/1/a.m4s")).body, payload);
  assert.deepEqual(ignored.calls, ["bytes=0-102399"]);
  const single = backend(payload);
  const small = createSegmentStore({ fetchChunk: single.fetchChunk, chunkBytes: 100 * 1024 });
  assert.deepEqual((await small.get("https://sbcdn3.example.test/dash/1/b.m4s")).body, payload);
  assert.deepEqual(single.calls, ["bytes=0-102399"]);
});

test("an upstream refusal is reported unchanged and never cached", async () => {
  const refused = backend(Buffer.alloc(10), { status: 403 });
  const store = createSegmentStore({ fetchChunk: refused.fetchChunk });
  const url = "https://sbcdn3.example.test/dash/1/c.m4s";
  const result = await store.get(url);
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, Buffer.from("refused"));
  await store.get(url);
  assert.equal(refused.calls.length, 2, "a refusal is not a cacheable segment");
});

test("oversized, truncated and empty segments fail loudly instead of being served", async () => {
  const payload = chunk(120 * 1024);
  const oversized = createSegmentStore({ fetchChunk: backend(payload).fetchChunk, chunkBytes: 100 * 1024, maxSegmentBytes: 64 * 1024 });
  await assert.rejects(oversized.get("https://sbcdn3.example.test/dash/1/d.m4s"), (error: unknown) => error instanceof SegmentError && error.code === "too_large");
  const truncated = createSegmentStore({ fetchChunk: async () => ({ status: 206, contentType: "video/iso.segment", body: Buffer.alloc(10), total: 4096 }) });
  await assert.rejects(truncated.get("https://sbcdn3.example.test/dash/1/e.m4s"), (error: unknown) => error instanceof SegmentError && error.code === "invalid_response");
  const empty = createSegmentStore({ fetchChunk: async () => ({ status: 200, contentType: "video/iso.segment", body: Buffer.alloc(0), total: 0 }) });
  await assert.rejects(empty.get("https://sbcdn3.example.test/dash/1/f.m4s"), (error: unknown) => error instanceof SegmentError && error.code === "invalid_response");
  // A 206 without a total cannot be completed, so it is not a segment.
  const untotalled = createSegmentStore({ fetchChunk: async () => ({ status: 206, contentType: "video/iso.segment", body: Buffer.alloc(10) }) });
  await assert.rejects(untotalled.get("https://sbcdn3.example.test/dash/1/g.m4s"), (error: unknown) => error instanceof SegmentError && error.code === "invalid_response");
  // A whole body arriving for a later window cannot be placed in the assembly, so it is refused.
  let answered = 0;
  const lateWholeBody = createSegmentStore({
    fetchChunk: async () => {
      answered++;
      if (answered === 1) return { status: 206, contentType: "video/iso.segment", body: Buffer.alloc(4096), total: 8192 };
      return { status: 200, contentType: "video/iso.segment", body: Buffer.alloc(9999), total: 9999 };
    },
  });
  await assert.rejects(lateWholeBody.get("https://sbcdn3.example.test/dash/1/h.m4s"), (error: unknown) => error instanceof SegmentError && error.code === "invalid_response");
});

test("retention is bounded by both count and bytes, evicting the least recently used", async () => {
  const payload = chunk(40 * 1024);
  const source = backend(payload);
  const store = createSegmentStore({ fetchChunk: source.fetchChunk, chunkBytes: 100 * 1024, maxSegments: 2 });
  const url = (name: string) => `https://sbcdn3.example.test/dash/1/${name}.m4s`;
  await store.get(url("a"));
  await store.get(url("b"));
  await store.get(url("a")); // a is now the most recently used
  await store.get(url("c"));
  const before = source.calls.length;
  await store.get(url("a"));
  assert.equal(source.calls.length, before, "the recently used segment survived eviction");
  await store.get(url("b"));
  assert.ok(source.calls.length > before, "the least recently used segment was evicted");
  // A byte bound evicts even when the segment count would allow more: two 40KB segments fit in 96KB.
  const bytes = createSegmentStore({ fetchChunk: source.fetchChunk, chunkBytes: 100 * 1024, maxSegments: 12, maxBytes: 96 * 1024 });
  for (const name of ["d", "e", "f"]) await bytes.get(url(name));
  const calls = source.calls.length;
  await bytes.get(url("d"));
  assert.ok(source.calls.length > calls, "the byte bound evicted the oldest segment");
  const held = source.calls.length;
  await bytes.get(url("f"));
  assert.equal(source.calls.length, held, "the newest segment is still held");
});

test("lookahead fetches ahead without disturbing the foreground and never throws", async () => {
  const payload = chunk(50 * 1024);
  const fetched: string[] = [];
  const fetchChunk: SegmentChunkFetcher = async (url) => {
    fetched.push(url);
    if (url.endsWith("bad.m4s")) throw new Error("upstream");
    return { status: 200, contentType: "video/iso.segment", body: payload, total: payload.byteLength };
  };
  const store = createSegmentStore({ fetchChunk, prefetchDepth: 2, prefetchConcurrency: 1 });
  const url = (name: string) => `https://sbcdn3.example.test/dash/1/${name}.m4s`;
  store.prefetch([url("a"), url("b"), url("c"), url("bad")]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fetched.length <= 3, `lookahead is bounded, saw ${fetched.length}`);
  // Already completed lookahead is not fetched twice, and the foreground read is served from it.
  const calls = fetched.length;
  await store.get(url("a"));
  assert.equal(fetched.length, calls);
});

test("lookahead fetches at its own narrow width while a player's segment fans out", async () => {
  const payload = chunk(1024 * 1024);
  const running = { foreground: 0, prefetch: 0 };
  const peak = { foreground: 0, prefetch: 0 };
  const fetchChunk: SegmentChunkFetcher = async (_url, range, priority) => {
    running[priority]++;
    peak[priority] = Math.max(peak[priority], running[priority]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running[priority]--;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), payload.byteLength - 1);
    return { status: 206, contentType: "video/iso.segment", body: payload.subarray(start, end + 1), total: payload.byteLength };
  };
  const store = createSegmentStore({ fetchChunk, chunkBytes: 100 * 1024, concurrency: 8, prefetchChunkConcurrency: 2, prefetchDepth: 1, prefetchConcurrency: 1 });
  const url = (name: string) => `https://sbcdn3.example.test/dash/1/${name}.m4s`;
  store.prefetch([url("ahead.m4s")]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(peak.prefetch, 2, "lookahead stays narrow so it cannot starve playback");
  await store.get(url("now.m4s"));
  assert.equal(peak.foreground, 8, "the segment a player waits for uses the full fan-out");
});

test("nonsensical store configuration is refused at construction", () => {
  const fetchChunk = backend(chunk(1024)).fetchChunk;
  for (const options of [{ chunkBytes: 0 }, { chunkBytes: 1024 }, { concurrency: 0 }, { concurrency: 25 },
    { maxSegments: 0 }, { maxSegments: 65 }, { maxBytes: 512 }, { maxSegmentBytes: 512 }, { prefetchDepth: 0 },
    { prefetchConcurrency: 9 }, { concurrency: 4, prefetchChunkConcurrency: 8 }, { prefetchChunkConcurrency: 0 }]) {
    assert.throws(() => createSegmentStore({ fetchChunk, ...options }), /Invalid segment store configuration/u, JSON.stringify(options));
  }
  assert.ok(createSegmentStore({ fetchChunk }));
  // Lookahead may be as narrow as the caller likes, but never wider than the store's own fan-out.
  assert.ok(createSegmentStore({ fetchChunk, concurrency: 4, prefetchChunkConcurrency: 4 }));
});
