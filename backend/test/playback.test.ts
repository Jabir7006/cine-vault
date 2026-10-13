import assert from "node:assert/strict";
import test from "node:test";
import { playbackDiscoveryKey, playbackIdentity, resolveOwnedSource, resolveSource } from "../../frontend/src/features/watch/playback.ts";
import type { Source } from "../../frontend/src/features/watch/types.ts";

const source = (provider: string): Source => ({
  type: "embed", provider, label: provider, embedUrl: `https://example.com/${provider}`,
});

test("provider IDs preserve preference across reordered responses", () => {
  const a = source("a");
  const b = source("b");
  const preferred = resolveSource([a, b])?.provider;
  assert.equal(resolveSource([b, a], preferred), a);
});

test("missing provider falls back without discarding preference", () => {
  const a = source("a");
  const b = source("b");
  assert.equal(resolveSource([b], "a"), b);
  assert.equal(resolveSource([], "a"), undefined);
  assert.equal(resolveSource([b, a], "a"), a);
});

test("provider preference stays independent of episode ownership", () => {
  const a = source("a");
  const b = source("b");
  const preferred = "b";
  const episode1 = playbackIdentity("tv", "123", 1, 1);
  const episode2 = playbackIdentity("tv", "123", 1, 2);
  assert.notEqual(episode1, episode2);
  assert.equal(resolveOwnedSource([a, b], preferred), b);
  assert.equal(resolveOwnedSource([b, a], preferred), b);
  assert.equal(resolveOwnedSource([a], preferred), a);
  assert.equal(resolveOwnedSource([a, b], preferred), b);
});

test("discovery keys isolate mounted owners and episode generations", () => {
  assert.notDeepEqual(playbackDiscoveryKey("owner1", "tv", "123", 1, 1), playbackDiscoveryKey("owner2", "tv", "123", 1, 1));
  assert.notDeepEqual(playbackDiscoveryKey("owner1", "tv", "123", 1, 1), playbackDiscoveryKey("owner1", "tv", "123", 1, 2));
  assert.deepEqual(playbackDiscoveryKey("owner1", "movie", "123", 1, 1), playbackDiscoveryKey("owner1", "movie", "123", 4, 10));
});

test("playback identity includes TV episode but movies ignore it", () => {
  assert.notEqual(playbackIdentity("tv", "123", 1, 1), playbackIdentity("tv", "123", 1, 2));
  assert.notEqual(playbackIdentity("tv", "123", 1, 1), playbackIdentity("tv", "123", 2, 1));
  assert.notEqual(playbackIdentity("tv", "123", 1, 1), playbackIdentity("tv", "124", 1, 1));
  assert.equal(playbackIdentity("movie", "123", 1, 1), playbackIdentity("movie", "123", 4, 10));
});
