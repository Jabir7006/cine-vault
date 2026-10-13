import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaybackReply } from "../../frontend/src/features/watch/session-response.ts";
import { resolveOwnedSource } from "../../frontend/src/features/watch/playback.ts";
import { canAutoCommitRenewal, canCommitPreparation, createPlaybackOperationGuard, replacementSelection, safeSeekTime, selectedStreamLink, samePreparedGeneration } from "../../frontend/src/features/watch/playback-session.ts";
import type { DirectSource, PreparedPlayback } from "../../frontend/src/features/watch/types.ts";

// Pure synthetic helpers: these do NOT prove React event ordering, native video
// seeking, clipboard permissions, or actual browser/upstream playback.
const owner = (): DirectSource => ({
  type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive",
  sessionId: "session_1", issuedAt: 100_000, revision: 1, controlToken: "C".repeat(42) + "A",
  renewAt: 170_000, expiresAt: 200_000, controlExpiresAt: 230_000,
  qualities: [{ id: "q1", label: "720p", url: "/media/video_old", height: 720 }],
  subtitles: [{ id: "en1", label: "English", lang: "en", url: "/media/sub_old" }],
  audios: [{ id: "a1", label: "English", lang: "en" }, { id: "a2", label: "French", lang: "fr" }], selectedAudio: "a1",
});
const prepared = (): PreparedPlayback => ({
  version: 1, kind: "prepared", baseRevision: 1, preparationId: "prep_1", preparationExpiresAt: 220_000,
  source: { ...owner(), revision: 2, issuedAt: 180_000, renewAt: 250_000, expiresAt: 280_000, controlExpiresAt: 310_000,
    qualities: [{ id: "q2", label: "720p", url: "/media/video_new", height: 720 }],
    subtitles: [{ id: "en2", label: "English", lang: "en", url: "/media/sub_new" }] },
  continuity: { kind: "same-resource", qualityId: "q2" },
});
const reject = (value: unknown) => assert.throws(() => parsePlaybackReply(value, owner()));

test("versioned prepared/state/commit/error replies validate before media normalization", () => {
  const pending = prepared();
  assert.deepEqual(parsePlaybackReply(pending, owner()), pending);
  const committed = { version: 1, kind: "committed", source: pending.source, pending: null };
  assert.deepEqual(parsePlaybackReply(committed, owner()), committed);
  const state = { version: 1, kind: "state", source: owner(), pending };
  assert.deepEqual(parsePlaybackReply(state, owner()), state);
  assert.deepEqual(parsePlaybackReply({ version: 1, kind: "error", code: "revision_conflict" }, owner()), { version: 1, kind: "error", code: "revision_conflict" });
  assert.deepEqual(parsePlaybackReply({ ...pending, continuity: { kind: "none" } }, owner()), { ...pending, continuity: { kind: "none" } });
});

test("operation discriminants, unknown fields, membership and owner/revision mismatches fail closed", () => {
  for (const value of [null, [], {}, { ...prepared(), version: 2 }, { ...prepared(), kind: "renewed" },
    { ...prepared(), extra: "private" }, { ...prepared(), baseRevision: 2 }, { ...prepared(), preparationId: "a/b" },
    { ...prepared(), preparationExpiresAt: 230_001 }, { ...prepared(), preparationExpiresAt: 0 },
    { ...prepared(), continuity: { kind: "same-resource", qualityId: "not_a_member" } },
    { ...prepared(), continuity: { kind: "none", etag: "private" } },
    { ...prepared(), continuity: { kind: "probably" } },
    { version: 1, kind: "error", code: "upstream https://example.test" },
    { version: 1, kind: "error", code: "UNAVAILABLE" },
    { version: 1, kind: "committed", source: owner() }]) reject(value);
  for (const changes of [{ sessionId: "other" }, { controlToken: "A".repeat(43) }, { revision: 3 }, { selectedAudio: "a2" },
    { qualities: [{ id: "q2", label: "720p", url: "https://example.test/media/raw" }] }]) {
    reject({ ...prepared(), source: { ...prepared().source, ...changes } });
  }
  reject({ ...prepared(), preparationExpiresAt: 240_001 });
  reject({ version: 1, kind: "state", source: owner(), pending: { ...prepared(), baseRevision: 2 } });
});

test("committed ownership survives candidate removal/reordering but explicit release allows preference", () => {
  const committed = owner();
  const embed = { type: "embed" as const, provider: "example", label: "Example", embedUrl: "https://example.test" };
  assert.equal(resolveOwnedSource([], "moviebox", committed), committed);
  assert.equal(resolveOwnedSource([embed, { ...owner(), sessionId: "candidate" }], "moviebox", committed), committed);
  assert.equal(resolveOwnedSource([embed], "example"), embed);
});

test("singleflight generation invalidation blocks away/back stale completions and renews once per revision", () => {
  const guard = createPlaybackOperationGuard();
  assert.equal(guard.claimRenewal(1), true);
  assert.equal(guard.claimRenewal(1), false);
  const old = guard.begin()!;
  assert.equal(guard.begin(), undefined);
  assert.equal(guard.claimRenewal(2), false);
  guard.invalidate();
  assert.equal(guard.current(old), false);
  guard.activate();
  const next = guard.begin()!;
  assert.equal(guard.current(old), false);
  assert.equal(guard.current(next), true);
  guard.finish(next);
  assert.equal(guard.claimRenewal(1), false);
  assert.equal(guard.claimRenewal(2), true);
});

test("renewal auto-commit requires current selection and server continuity; explicit unproven replacement remains possible", () => {
  assert.equal(canAutoCommitRenewal(owner(), prepared(), "q1", "q1", 190_000), true);
  assert.equal(canAutoCommitRenewal(owner(), prepared(), "other", "q1", 190_000), false);
  assert.equal(canAutoCommitRenewal(owner(), { ...prepared(), continuity: { kind: "none" } }, "q1", "q1", 190_000), false);
  assert.equal(canCommitPreparation(owner(), prepared(), 220_000), false);
  assert.equal(canCommitPreparation(owner(), { ...prepared(), baseRevision: 2 }, 190_000), false);
  assert.equal(canCommitPreparation(owner(), { ...prepared(), continuity: { kind: "none" } }, 190_000), true);
  assert.equal(canAutoCommitRenewal(owner(), { ...prepared(), source: { ...prepared().source, selectedAudio: "a2" } }, "q1", "q1", 190_000), false);
});

test("selection retains stable/mapped options and subtitle language, not quality labels or guessed timelines", () => {
  assert.deepEqual(replacementSelection(owner(), prepared().source, "q1", "en1", "q2"), { qualityId: "q2", subtitleId: "en2" });
  assert.deepEqual(replacementSelection(owner(), prepared().source, "q1", "off"), { qualityId: "q2", subtitleId: "off" });
  assert.equal(safeSeekTime(30, 100, [[0, 60]]), 30);
  assert.equal(safeSeekTime(200, 100, [[0, 100]]), 99.95);
  assert.equal(safeSeekTime(30, 100, []), undefined);
  assert.equal(safeSeekTime(30, NaN, [[0, 100]]), undefined);
  assert.equal(safeSeekTime(30, 100, [[40, 60]]), undefined);
});

test("lost-response reconciliation recognizes only the exact staged public generation", () => {
  assert.equal(samePreparedGeneration(prepared().source, structuredClone(prepared().source)), true);
  for (const changes of [{ sessionId: "other" }, { revision: 3 }, { selectedAudio: "a2" }, { expiresAt: 290_000 },
    { qualities: [{ id: "q2", label: "720p", url: "/media/different" }] }, { subtitles: [] }]) {
    assert.equal(samePreparedGeneration(prepared().source, { ...prepared().source, ...changes }), false);
  }
});

test("copy exports only the selected committed unexpired media bearer, never control/upstream/embed URLs", () => {
  const source = owner();
  source.qualities = [
    { id: "q1", label: "720p", url: "https://backend.example.test/media/video_one" },
    { id: "q2", label: "1080p", url: "https://backend.example.test/media/video_two" },
  ];
  const link = selectedStreamLink(source, "q2", 190_000);
  assert.equal(link, source.qualities[1]!.url);
  assert.equal(link?.includes(source.controlToken), false);
  assert.equal(selectedStreamLink(source, "q2", source.expiresAt), undefined);
  assert.equal(selectedStreamLink(source, "missing", 190_000), undefined);
  for (const url of ["https://upstream.example.test/video.mp4", "https://backend.example.test/media/token?control=secret",
    `https://backend.example.test/media/${source.controlToken}`, "https://user:pass@backend.example.test/media/token",
    "https://example.test/embed/player", "/media/video_one"]) {
    assert.equal(selectedStreamLink({ ...source, qualities: [{ ...source.qualities[0]!, url }] }, "q1", 190_000), undefined);
  }
});
