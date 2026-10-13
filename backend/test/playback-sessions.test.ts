import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackSessions, PlaybackError } from "../src/moviebox/playback-sessions";
import type { PlaybackBinding, PrivateDiscovery } from "../src/moviebox/playback-sessions";
import { createMediaRegistry } from "../src/media/registry";
import type { MediaResource } from "../src/media/types";
import { createApp } from "../src/app";
import { parseCommit, parsePrepare } from "../src/routes/playback";
import { parseSourcesResponse } from "../../frontend/src/features/watch/source-response";
import { parsePlaybackReply } from "../../frontend/src/features/watch/session-response";

const instant = 1_800_000_000_000;
const binding: PlaybackBinding = { type: "movie", tmdbId: "42", subjectId: "1", target: { type: "movie", titles: ["Synthetic"], year: 2020 } };
const video: MediaResource = { kind: "video", url: "https://media.example.test/fixture.mp4", headers: { "X-Fixture": "private" },
  resourceId: "10", codec: "H264", height: 720, representation: { etag: '"fixture"', length: 1000 } };
const code = (expected: string) => (error: unknown) => error instanceof PlaybackError && error.code === expected;
function fixture(options: { capacity?: number; ttlMs?: number } = {}) {
  let clock = instant; let refreshes = 0;
  let resource = structuredClone(video);
  let failure = false;
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), capacity: options.capacity ?? 4096, ttlMs: options.ttlMs, now: () => clock });
  const bundle = (): PrivateDiscovery => ({ binding: structuredClone(binding), expiresAt: clock + 300000,
    audios: [
      { subjectId: "1", lang: "und", label: "Source audio", videos: [structuredClone(resource)], captions: [] },
      { subjectId: "2", lang: "bn", label: "Bangla", videos: [{ ...structuredClone(resource), url: "https://media.example.test/dub.mp4" }], captions: [] },
    ] });
  const service = createPlaybackSessions({ registry, now: () => clock, refresh: async () => { refreshes++; return failure ? undefined : bundle(); } });
  return { registry, service, issue: () => service.issue(bundle()), tick: (ms: number) => { clock += ms; },
    change: (patch: Partial<MediaResource>) => { resource = { ...resource, ...patch }; }, fail: () => { failure = true; }, get refreshes() { return refreshes; } };
}
const tokenOf = (url: string) => url.slice("/media/".length);

test("each issuance owns a fresh session, control capability and independent media", () => {
  const f = fixture(); const a = f.issue(); const b = f.issue();
  assert.notEqual(a.sessionId, b.sessionId); assert.notEqual(a.controlToken, b.controlToken);
  assert.notEqual(a.qualities[0]!.url, b.qualities[0]!.url);
  assert.throws(() => f.service.state(a.sessionId, b.controlToken), code("unauthorized"));
  assert.throws(() => f.service.state(a.sessionId, ""), code("unauthorized"));
  a.qualities.length = 0;
  const state = f.service.state(a.sessionId, a.controlToken);
  assert.equal(state.kind, "state"); assert.equal(state.source.qualities.length, 1);
});

test("prepare is read-only until atomic commit; lost response reconciles via GET state", async () => {
  const f = fixture(); const a = f.issue();
  f.tick(5000);
  const prep = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew", qualityId: a.qualities[0]!.id });
  assert.equal(prep.kind, "prepared"); assert.equal(prep.source.revision, 2);
  assert.equal(prep.source.issuedAt, instant + 5000);
  assert.deepEqual(prep.continuity, { kind: "same-resource", qualityId: prep.source.qualities[0]!.id });
  assert.equal(f.service.state(a.sessionId, a.controlToken).source.revision, 1);
  assert.equal(prep.source.controlExpiresAt, a.controlExpiresAt);
  assert.throws(() => f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 2, preparationId: prep.preparationId }), code("conflict"));
  f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, preparationId: prep.preparationId });
  const recovered = f.service.state(a.sessionId, a.controlToken);
  assert.equal(recovered.source.revision, 2);
  assert.equal(f.registry.resolve(tokenOf(a.qualities[0]!.url), "GET")?.kind, "video");
  assert.throws(() => f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, preparationId: prep.preparationId }), code("conflict"));
});

test("advancing server clock still issues preparations accepted by the frontend contract", async () => {
  let clock = instant;
  const now = () => clock++;
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now });
  const bundle = (): PrivateDiscovery => ({ binding: structuredClone(binding), expiresAt: clock + 300000,
    audios: [{ subjectId: "1", label: "Source audio", lang: "und", videos: [structuredClone(video)], captions: [] }] });
  const service = createPlaybackSessions({ registry, now, refresh: async () => bundle() });
  const source = service.issue(bundle());
  assert.deepEqual(parseSourcesResponse({ version: 2, sources: [source], moviebox: { status: "ready" } }).sources[0], source);
  const pending = await service.prepare(source.sessionId, source.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  assert.ok(pending.preparationExpiresAt <= pending.source.issuedAt + 60000);
  assert.deepEqual(parsePlaybackReply(pending, source), pending);
  const committed = service.commit(source.sessionId, source.controlToken, { version: 1, baseRevision: 1, preparationId: pending.preparationId });
  assert.deepEqual(parsePlaybackReply(committed, source), committed);
});

test("exact selected representation is necessary for continuity; audio changes always restart", async () => {
  for (const patch of [{ representation: undefined }, { representation: { etag: '"changed"', length: 1000 } },
    { representation: { etag: '"fixture"', length: 1001 } }, { url: "https://media.example.test/changed.mp4" },
    { headers: { "X-Fixture": "changed" } }, { codec: "avc1" }]) {
    const f = fixture(); const a = f.issue(); f.change(patch);
    const prep = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew", qualityId: a.qualities[0]!.id });
    assert.deepEqual(prep.continuity, { kind: "none" });
  }
  const f = fixture(); const a = f.issue();
  const prep = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "audio", audioId: a.audios[1]!.id });
  assert.equal(prep.source.selectedAudio, a.audios[1]!.id); assert.deepEqual(prep.continuity, { kind: "none" });
  assert.equal(f.service.state(a.sessionId, a.controlToken).source.selectedAudio, a.selectedAudio);
});

test("membership, revision and auth rejection happen before upstream work", async () => {
  const f = fixture(); const a = f.issue();
  for (const input of [{ version: 1, baseRevision: 2, reason: "renew" },
    { version: 1, baseRevision: 1, reason: "audio", audioId: "raw-subject-id" },
    { version: 1, baseRevision: 1, reason: "renew", qualityId: "raw-resource-id" }] as const) {
    await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, input), (error: unknown) => error instanceof PlaybackError);
  }
  await assert.rejects(f.service.prepare(a.sessionId, "x".repeat(43), { version: 1, baseRevision: 1, reason: "renew" }), code("unauthorized"));
  assert.equal(f.refreshes, 0);
});

test("failure, expired staging and revoked staging preserve current playback", async () => {
  const f = fixture(); const a = f.issue();
  const prep = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  f.registry.revoke(tokenOf(prep.source.qualities[0]!.url));
  assert.throws(() => f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, preparationId: prep.preparationId }), code("unavailable"));
  assert.equal(f.service.state(a.sessionId, a.controlToken).source.revision, 1);
  f.tick(5000);
  const next = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  f.tick(60000);
  assert.equal(f.service.state(a.sessionId, a.controlToken).pending, null);
  assert.equal(f.registry.resolve(tokenOf(next.source.qualities[0]!.url), "GET"), undefined);
  f.fail();
  await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("unavailable"));
  assert.ok(f.registry.resolve(tokenOf(a.qualities[0]!.url), "GET"));
});

test("atomic media saturation never evicts committed playback and registry deadline is advertised", async () => {
  const f = fixture({ capacity: 1, ttlMs: 90000 }); const a = f.issue();
  assert.equal(a.expiresAt, instant + 90000);
  assert.equal(f.registry.expiresAt(tokenOf(a.qualities[0]!.url)), a.expiresAt);
  await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("unavailable"));
  assert.ok(f.registry.resolve(tokenOf(a.qualities[0]!.url), "GET"));
});

test("32-session admission, pending singleton, cooldown, retired generations and lifetime are bounded", async () => {
  const f = fixture(); const owners = Array.from({ length: 32 }, () => f.issue());
  assert.throws(() => f.issue(), code("unavailable"));
  const a = owners[0]!;
  const prep = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("busy"));
  f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 1, preparationId: prep.preparationId });
  await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 2, reason: "renew" }), code("rate_limited"));
  f.tick(5000);
  const second = await f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 2, reason: "renew" });
  f.service.commit(a.sessionId, a.controlToken, { version: 1, baseRevision: 2, preparationId: second.preparationId });
  f.tick(5000);
  await assert.rejects(f.service.prepare(a.sessionId, a.controlToken, { version: 1, baseRevision: 3, reason: "renew" }), code("busy"));
  f.tick(330001);
  assert.throws(() => f.service.state(a.sessionId, a.controlToken), code("unauthorized"));
  assert.ok(f.issue());
});

test("rolling eight-preparation budget remains bounded even when upstream fails", async () => {
  const f = fixture(); const owner = f.issue(); f.fail();
  for (let attempt = 0; attempt < 8; attempt++) {
    await assert.rejects(f.service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("unavailable"));
    f.tick(5000);
  }
  await assert.rejects(f.service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("rate_limited"));
  assert.equal(f.refreshes, 8);
});

test("commit can renew grace but cannot extend the absolute session cap", async () => {
  const f = fixture(); let source = f.issue(); const ownerIssued = source.issuedAt;
  for (let step = 0; step < 5; step++) {
    f.tick(300001);
    const prep = await f.service.prepare(source.sessionId, source.controlToken, { version: 1, baseRevision: source.revision, reason: "renew" });
    source = f.service.commit(source.sessionId, source.controlToken, { version: 1, baseRevision: source.revision, preparationId: prep.preparationId }).source;
    assert.ok(source.controlExpiresAt <= ownerIssued + 1800000);
  }
  f.tick(299994);
  const final = await f.service.prepare(source.sessionId, source.controlToken, { version: 1, baseRevision: source.revision, reason: "renew" });
  source = f.service.commit(source.sessionId, source.controlToken, { version: 1, baseRevision: source.revision, preparationId: final.preparationId }).source;
  assert.equal(source.controlExpiresAt, ownerIssued + 1800000);
  f.tick(1);
  assert.throws(() => f.service.state(source.sessionId, source.controlToken), code("unauthorized"));
});

test("continuity uses registry-owned descriptors, not mutable issuance aliases", async () => {
  let clock = instant;
  const resource = structuredClone(video);
  const discovery: PrivateDiscovery = { binding: structuredClone(binding), expiresAt: clock + 300000,
    audios: [{ subjectId: "1", label: "Source audio", lang: "und", videos: [resource], captions: [] }] };
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => clock });
  const service = createPlaybackSessions({ registry, now: () => clock, refresh: async () => discovery });
  const owner = service.issue(discovery);
  resource.representation!.etag = '"mutated"';
  clock += 5000;
  const prep = await service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  assert.deepEqual(prep.continuity, { kind: "none" });
  assert.equal(registry.resolve(tokenOf(owner.qualities[0]!.url), "GET")?.representation?.etag, '"fixture"');
});

test("aborted refresh rolls back ownership and cannot publish late capabilities", async () => {
  let release: ((value: PrivateDiscovery) => void) | undefined;
  let clock = instant;
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => clock });
  const discovery: PrivateDiscovery = { binding: structuredClone(binding), expiresAt: clock + 300000,
    audios: [{ subjectId: "1", label: "Source audio", lang: "und", videos: [structuredClone(video)], captions: [] }] };
  const service = createPlaybackSessions({ registry, now: () => clock,
    refresh: async () => new Promise<PrivateDiscovery>((resolve) => { release = resolve; }) });
  const owner = service.issue(discovery); const controller = new AbortController();
  const running = service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }, controller.signal);
  controller.abort(); await assert.rejects(running, code("unavailable"));
  clock += 5000;
  await assert.rejects(service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("busy"));
  release!(discovery); await Promise.resolve(); await Promise.resolve();
  const state = service.state(owner.sessionId, owner.controlToken);
  assert.equal(state.source.revision, 1); assert.equal(state.pending, null);
});

test("retired committed media survives shortened control ownership to its natural expiry", async () => {
  const f = fixture(); const owner = f.issue();
  f.tick(5000); f.change({ expiresAt: instant + 165000 });
  const prep = await f.service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" });
  const next = f.service.commit(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, preparationId: prep.preparationId }).source;
  assert.equal(next.expiresAt, instant + 105000); assert.equal(next.controlExpiresAt, instant + 135000);
  f.tick(130001);
  assert.throws(() => f.service.state(owner.sessionId, owner.controlToken), code("unauthorized"));
  assert.ok(f.registry.resolve(tokenOf(owner.qualities[0]!.url), "GET"));
  f.tick(165000);
  assert.equal(f.registry.resolve(tokenOf(owner.qualities[0]!.url), "GET"), undefined);
});

test("strict operation parsers reject unknown fields and malformed IDs/revisions", () => {
  for (const input of [{ version: 1, baseRevision: 1, reason: "renew", url: "https://private.test" },
    { version: 1, baseRevision: 1, reason: "audio" }, { version: 1, baseRevision: 0, reason: "renew" },
    { version: 2, baseRevision: 1, reason: "renew" }, { version: 1, baseRevision: 1, reason: "renew", qualityId: null }]) assert.throws(() => parsePrepare(input), code("invalid_request"));
  assert.throws(() => parseCommit({ version: 1, baseRevision: 1, preparationId: "x".repeat(32), headers: {} }), code("invalid_request"));
});

test("12-second preparation deadline returns while non-cooperative work keeps ownership busy", async () => {
  const registry = createMediaRegistry({ signingKey: "ab".repeat(32), now: () => instant });
  const discovery: PrivateDiscovery = { binding: structuredClone(binding), expiresAt: instant + 300000,
    audios: [{ subjectId: "1", label: "Source audio", lang: "und", videos: [structuredClone(video)], captions: [] }] };
  const service = createPlaybackSessions({ registry, now: () => instant,
    refresh: async () => new Promise<PrivateDiscovery>(() => undefined) });
  const owner = service.issue(discovery);
  await assert.rejects(service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("unavailable"));
  await assert.rejects(service.prepare(owner.sessionId, owner.controlToken, { version: 1, baseRevision: 1, reason: "renew" }), code("busy"));
  assert.ok(registry.resolve(tokenOf(owner.qualities[0]!.url), "GET"));
});

test("stalled streamed operation body has a bounded sanitized response", async () => {
  const f = fixture(); const owner = f.issue(); const app = createApp({ allowedOrigins: [], playback: f.service });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } });
  const request = new Request(`http://localhost/api/playback/${owner.sessionId}/prepare`, {
    method: "POST", headers: { "content-type": "application/json", "x-playback-control": owner.controlToken },
    body: stream, duplex: "half",
  } as RequestInit);
  const response = await app.fetch(request);
  assert.equal(response.status, 400); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { version: 1, kind: "error", code: "invalid_request" });
  assert.equal(f.refreshes, 0);
});

test("operation routes require both deployment and independent control capabilities and sanitize errors", async () => {
  const f = fixture(); const a = f.issue();
  const app = createApp({ allowedOrigins: ["http://localhost:5173"], accessToken: "fixture-access", playback: f.service });
  const path = `/api/playback/${a.sessionId}`;
  assert.equal((await app.request(path)).status, 401);
  const headers = { "x-access-token": "fixture-access", "x-playback-control": a.controlToken, "content-type": "application/json" };
  const state = await app.request(path, { headers }); assert.equal(state.status, 200); assert.equal(state.headers.get("cache-control"), "no-store");
  const wrong = await app.request(path, { headers: { ...headers, "x-playback-control": "z".repeat(43) } });
  assert.deepEqual(await wrong.json(), { version: 1, kind: "error", code: "unauthorized" });
  assert.equal(wrong.headers.get("cache-control"), "no-store");
  for (const raw of ["null", "[]", "{", JSON.stringify({ version: 1, baseRevision: 1, reason: "renew", extra: true }), "x".repeat(2049)]) {
    const response = await app.request(`${path}/prepare`, { method: "POST", headers, body: raw });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { version: 1, kind: "error", code: "invalid_request" });
  }
  const prepared = await app.request(`${path}/prepare`, { method: "POST", headers, body: JSON.stringify({ version: 1, baseRevision: 1, reason: "renew" }) });
  assert.equal(prepared.status, 200);
  const reply = parsePlaybackReply(await prepared.json(), a);
  assert.equal(reply.kind, "prepared");
  assert.ok(reply.kind === "prepared");
  const committed = await app.request(`${path}/commit`, { method: "POST", headers, body: JSON.stringify({ version: 1, baseRevision: 1, preparationId: reply.preparationId }) });
  assert.equal(committed.status, 200);
  const committedReply = parsePlaybackReply(await committed.json(), a);
  assert.ok(committedReply.kind === "committed");
  assert.equal(committedReply.source.revision, 2);
  const cors = await app.request(path, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "x-playback-control" } });
  assert.ok(cors.headers.get("access-control-allow-headers")?.includes("x-playback-control"));
});
