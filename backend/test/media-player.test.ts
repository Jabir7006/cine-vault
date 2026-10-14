import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerLeases, PlayerError } from "../src/media/player.ts";
import { TransportError } from "../src/media/transport.ts";
import type { MediaResource, MediaTransport } from "../src/media/types.ts";

const manifest = (generation: number): MediaResource => ({
  url: `https://sbcdn3.example.test/dash/gen${generation}/index.mpd`,
  kind: "manifest",
  headers: { cookie: `sign=gen${generation}` },
});

/** A transport that records which generation it was asked to read and to serve. */
const fakeTransport = (options: { heights?: (generation: number) => number[]; refuseSegments?: (generation: number) => boolean } = {}) => {
  const reads: string[] = [];
  const served: string[] = [];
  const transport = {
    reads,
    served,
    readManifest: async (resource: MediaResource) => {
      reads.push(resource.url);
      const generation = Number(/gen(\d+)/.exec(resource.url)![1]);
      return { xml: `<MPD gen="${generation}"/>`, heights: (options.heights ?? (() => [1080, 720, 480]))(generation) };
    },
    relayManifest: async (resource: MediaResource, publicBase: string, method: "GET" | "HEAD") =>
      new Response(method === "HEAD" ? null : `<MPD base="${publicBase}" source="${resource.url}"/>`,
        { headers: { "content-type": "application/dash+xml" } }),
    relaySegment: async (resource: MediaResource, name: string) => {
      const generation = Number(/gen(\d+)/.exec(resource.url)![1]);
      if (options.refuseSegments?.(generation)) throw new TransportError("upstream");
      served.push(`${name}@gen${generation}`);
      return new Response(`segment ${name} gen${generation}`, { headers: { "content-type": "video/mp4" } });
    },
  };
  return { transport: transport as unknown as MediaTransport, reads, served };
};

/** An authorizer that hands out one generation per call and records every negotiation. */
const sequence = (...generations: (number | undefined)[]) => {
  const calls: number[] = [];
  return {
    calls,
    authorize: async () => {
      calls.push(calls.length);
      const generation = generations[Math.min(calls.length - 1, generations.length - 1)];
      return generation === undefined ? undefined : manifest(generation);
    },
  };
};

const body = async (response: Response) => await response.text();

test("a lease serves its manifest rewritten onto the lease and its segments through the same URL", async () => {
  const fake = fakeTransport();
  const source = sequence(1);
  const leases = createPlayerLeases({ transport: fake.transport });
  const lease = await leases.open("session-a", source.authorize);
  assert.match(lease.id, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(lease.base, `/player/${lease.id}/`);
  assert.equal(leases.manifestPath(lease.id), `/player/${lease.id}/index.mpd`);
  assert.deepEqual(leases.ladder(lease.id), [1080, 720, 480]);
  // The manifest names the lease, never the CDN, so every segment request returns here.
  assert.match(await body(await leases.manifest(lease.id, "GET")), new RegExp(`base="/player/${lease.id}/"`));
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00001.m4s", undefined)), "segment chunk-stream0-00001.m4s gen1");
  assert.deepEqual(fake.served, ["chunk-stream0-00001.m4s@gen1"]);
});

test("one lease per key: a second open returns the same lease and never re-authorizes", async () => {
  const fake = fakeTransport();
  const first = sequence(1);
  const second = sequence(2);
  const leases = createPlayerLeases({ transport: fake.transport });
  const lease = await leases.open("session-a", first.authorize);
  const again = await leases.open("session-a", second.authorize);
  assert.equal(again.id, lease.id);
  assert.equal(await leases.find("session-a")!.id, lease.id);
  assert.equal(second.calls.length, 0);
  // A different key is a different lease over its own authorization.
  const other = await leases.open("session-b", second.authorize);
  assert.notEqual(other.id, lease.id);
  assert.equal(second.calls.length, 1);
});

test("an expired authorization is replaced in place: the lease URL never changes", async () => {
  const fake = fakeTransport();
  const source = sequence(1, 2);
  let clock = 1_000_000;
  const leases = createPlayerLeases({ transport: fake.transport, now: () => clock });
  const lease = await leases.open("session-a", source.authorize);
  assert.equal(fake.reads.length, 1);
  // Past the rotation age a request still answers immediately, from the generation already proven.
  clock += 6 * 60_000 + 1;
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00002.m4s", undefined)), "segment chunk-stream0-00002.m4s gen1");
  await leases.settle(lease.id);
  assert.deepEqual(fake.reads, [manifest(1).url, manifest(2).url]);
  assert.equal(source.calls.length, 2);
  // From the next request on, segments come from the replacement under the same lease.
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00003.m4s", undefined)), "segment chunk-stream0-00003.m4s gen2");
  assert.equal(leases.manifestPath(lease.id), `/player/${lease.id}/index.mpd`);
});

test("a replacement that is not the same encode is refused rather than adopted", async () => {
  const fake = fakeTransport({ heights: (generation) => generation === 1 ? [1080, 720, 480] : [1080] });
  const source = sequence(1, 2);
  let clock = 1_000_000;
  const leases = createPlayerLeases({ transport: fake.transport, now: () => clock });
  const lease = await leases.open("session-a", source.authorize);
  clock += 6 * 60_000 + 1;
  await leases.manifest(lease.id, "GET");
  await leases.settle(lease.id);
  // A ladder that describes a different encode would strand a player mid-film, so it is discarded
  // and the lease keeps serving the authorization it has already proved.
  assert.deepEqual(leases.ladder(lease.id), [1080, 720, 480]);
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00004.m4s", undefined)), "segment chunk-stream0-00004.m4s gen1");
});

test("a lease whose authorization cannot be replaced fails only after its grace period", async () => {
  const fake = fakeTransport();
  const source = sequence(1, undefined);
  let clock = 1_000_000;
  const leases = createPlayerLeases({ transport: fake.transport, now: () => clock });
  const lease = await leases.open("session-a", source.authorize);
  // Due but not overdue: a failed renewal is invisible, and the film keeps playing.
  clock += 7 * 60_000;
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00005.m4s", undefined)), "segment chunk-stream0-00005.m4s gen1");
  await leases.settle(lease.id);
  assert.ok(source.calls.length >= 2);
  // Past the grace period the same lease refuses instead of serving an authorization it cannot renew.
  clock += 3 * 60_000;
  await assert.rejects(() => leases.manifest(lease.id, "GET"), (error: unknown) => error instanceof PlayerError && error.code === "stale" && error.status === 503);
});

test("a refused segment is retried once through a fresh authorization", async () => {
  const fake = fakeTransport({ refuseSegments: (generation) => generation === 1 });
  const source = sequence(1, 2);
  let clock = 1_000_000;
  const leases = createPlayerLeases({ transport: fake.transport, now: () => clock });
  const lease = await leases.open("session-a", source.authorize);
  clock += 6 * 60_000 + 1;
  // The CDN refusing the authorization behind the lease is recoverable: a new one is negotiated and
  // the request is answered from it, all under the URL the player is already reading.
  assert.equal(await body(await leases.segment(lease.id, "chunk-stream0-00006.m4s", undefined)), "segment chunk-stream0-00006.m4s gen2");
  assert.deepEqual(fake.served, ["chunk-stream0-00006.m4s@gen2"]);
});

test("unknown, malformed and over-capacity leases are refused", async () => {
  const fake = fakeTransport();
  const source = sequence(1);
  const leases = createPlayerLeases({ transport: fake.transport, capacity: 1 });
  await leases.open("session-a", source.authorize);
  const missing = "a".repeat(32);
  for (const id of [missing, "..", "%2e%2e", "", "a".repeat(31), "a".repeat(33)]) {
    await assert.rejects(() => leases.manifest(id, "GET"), (error: unknown) => error instanceof PlayerError && error.code === "unknown_lease" && error.status === 404);
  }
  await assert.rejects(() => leases.segment(missing, "chunk-stream0-00001.m4s", undefined), (error: unknown) => error instanceof PlayerError && error.code === "unknown_lease");
  await assert.rejects(() => leases.open("session-b", source.authorize), (error: unknown) => error instanceof PlayerError && error.code === "unavailable");
  // A lease that cannot be opened at all never becomes addressable.
  await assert.rejects(() => leases.open("session-c", async () => undefined), (error: unknown) => error instanceof PlayerError && error.code === "unavailable");
});

test("a lease nothing is reading is given up for a new one; a lease being read never is", async () => {
  const fake = fakeTransport();
  let clock = 1_000_000;
  const leases = createPlayerLeases({ transport: fake.transport, capacity: 1, now: () => clock });
  const first = await leases.open("session-a", sequence(1).authorize);
  // A lease a moment old is evidence of nothing, so a second viewer is refused rather than guessed at.
  await assert.rejects(() => leases.open("session-b", sequence(1).authorize),
    (error: unknown) => error instanceof PlayerError && error.code === "unavailable");
  // However long the clock runs, a lease something is still reading is not a candidate.
  clock += 30 * 60_000;
  await leases.segment(first.id, "chunk-stream0-00001.m4s", undefined);
  await assert.rejects(() => leases.open("session-b", sequence(1).authorize),
    (error: unknown) => error instanceof PlayerError && error.code === "unavailable");
  // Past a whole idle window with no reader, the slot belongs to the viewer who is here now.
  clock += 2 * 60_000 + 1;
  const second = await leases.open("session-b", sequence(1).authorize);
  assert.notEqual(second.id, first.id);
  assert.equal(leases.find("session-a"), undefined);
  await assert.rejects(() => leases.manifest(first.id, "GET"),
    (error: unknown) => error instanceof PlayerError && error.code === "unknown_lease" && error.status === 404);
});

test("a lease may be closed, after which its URL no longer resolves", async () => {
  const fake = fakeTransport();
  const leases = createPlayerLeases({ transport: fake.transport });
  const lease = await leases.open("session-a", sequence(1).authorize);
  assert.equal(await body(await leases.manifest(lease.id, "GET")).then((text) => text.includes("base=")), true);
  leases.close(lease.id);
  assert.equal(leases.find("session-a"), undefined);
  await assert.rejects(() => leases.manifest(lease.id, "GET"), (error: unknown) => error instanceof PlayerError && error.code === "unknown_lease");
  // The key is free again, so a new lease is a new URL rather than the closed one.
  const reopened = await leases.open("session-a", sequence(1).authorize);
  assert.notEqual(reopened.id, lease.id);
});

test("a lease reports a HEAD manifest without a body", async () => {
  const fake = fakeTransport();
  const leases = createPlayerLeases({ transport: fake.transport });
  const lease = await leases.open("session-a", sequence(1).authorize);
  const response = await leases.manifest(lease.id, "HEAD");
  assert.equal(response.headers.get("content-type"), "application/dash+xml");
  assert.equal(await response.text(), "");
});

test("lease configuration outside its bounds is refused", () => {
  const fake = fakeTransport();
  for (const options of [
    { capacity: 0 }, { capacity: 65 }, { capacity: 1.5 },
    { leaseMs: 1_000 }, { leaseMs: 13 * 60 * 60_000 },
    { idleEvictMs: 999 }, { idleEvictMs: 7 * 60 * 60_000 },
    { rotationMs: 1_000 }, { hardMs: 1_000 }, { retryMs: 10 }, { renewMs: 10 },
  ]) {
    assert.throws(() => createPlayerLeases({ transport: fake.transport, ...options }), /Invalid player lease configuration/);
  }
  // A transport that cannot serve an adaptive stream cannot back a lease at all.
  assert.throws(() => createPlayerLeases({ transport: {} as MediaTransport }), /Invalid player lease configuration/);
});
