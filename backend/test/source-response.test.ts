import assert from "node:assert/strict";
import test from "node:test";
import { parseSourcesResponse } from "../../frontend/src/features/watch/source-response.ts";
import { createSourceService } from "../src/providers/index.ts";

// Entirely synthetic capability strings, timestamps and public response data.
// No upstream access, operator keys, media URLs or network requests are used.
const capability = (kind = "video", suffix = "a") =>
  `/media/v1.${kind}.GET-HEAD.${"A".repeat(31)}${suffix}.1000000.${"B".repeat(43)}`;

const direct = () => ({
  type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive",
  sessionId: "session_1", renewAt: 900_000, expiresAt: 1_000_000,
  qualities: [
    { id: "quality_720", label: "720p", url: capability(), height: 720 },
    { id: "quality_1080", label: "1080p", url: capability("video", "b"), height: 1080 },
  ],
  subtitles: [{ id: "english", label: "English", lang: "en", url: capability("subtitle") }],
  audios: [{ id: "original", label: "Original", lang: "en" }], selectedAudio: "original",
});

const embed = () => ({
  type: "embed", provider: "example", label: "Example provider", embedUrl: "https://example.test/player?id=1",
});

const ready = () => ({ version: 1, moviebox: { status: "ready" }, sources: [direct(), embed()] });
const fallback = (status = "blocked_setup") => ({ version: 1, moviebox: { status }, sources: [embed()] });

const rejects = (value: unknown) => assert.throws(
  () => parseSourcesResponse(value),
  { name: "Error", message: "Playback sources are unavailable or malformed. Please refresh or switch provider." },
);

const mutateDirect = (change: (value: Record<string, unknown>) => void) => {
  const value = ready();
  change(value.sources[0] as unknown as Record<string, unknown>);
  rejects(value);
};

test("v1 parser accepts actual progressive choices and preserves fallback order", () => {
  const value = ready();
  assert.deepEqual(parseSourcesResponse(value), value);
  assert.deepEqual(parseSourcesResponse(fallback()), fallback());
  assert.deepEqual(parseSourcesResponse({ version: 1, moviebox: { status: "not_found" }, sources: [] }), {
    version: 1, moviebox: { status: "not_found" }, sources: [],
  });
});

test("missing-setup backend responses preserve all five existing embed candidates", async () => {
  const service = createSourceService();
  for (const type of ["movie", "tv"] as const) {
    const response = await service(type, "123", { season: 2, episode: 3 });
    const parsed = parseSourcesResponse(response);
    assert.deepEqual(parsed, response);
    assert.equal(parsed.moviebox.status, "blocked_setup");
    assert.deepEqual(parsed.sources.map((source) => source.provider), [
      "embedwave.cc", "vidcore.org", "vidsrc.to", "vidlink", "2embed",
    ]);
  }
});

test("all known non-ready states retain embeds; unknown statuses and versions fail", () => {
  for (const status of ["blocked_setup", "not_found", "ambiguous", "unverified", "unsupported_adaptive", "unsupported_format", "unavailable"]) {
    assert.equal(parseSourcesResponse(fallback(status)).moviebox.status, status);
  }
  for (const value of [null, undefined, [], "ready", {}, { ...ready(), version: 2 }, { ...ready(), version: "1" },
    { ...ready(), moviebox: null }, { ...ready(), moviebox: { status: "unsupported" } },
    { ...ready(), moviebox: { status: "READY" } }, { ...ready(), sources: null }]) rejects(value);
});

test("unsupported legacy/adaptive source types and inconsistent ready states fail", () => {
  mutateDirect((source) => { source.type = "dash"; });
  mutateDirect((source) => { source.format = "hls"; });
  mutateDirect((source) => { source.provider = "other"; });
  rejects({ ...ready(), moviebox: { status: "unavailable" } });
  rejects(fallback("ready"));
  rejects({ ...fallback(), sources: [{ ...embed(), provider: "moviebox" }] });
});

test("embed URLs must be bounded HTTPS without credentials or misleading parsing", () => {
  for (const url of ["http://example.test/player", "//example.test/player", "javascript:alert(1)",
    "https://user:secret@example.test/player", "https://@example.test/player", "https:\\example.test/player",
    "https://example.test/\nplayer", "https://", `https://example.test/${"x".repeat(4096)}`]) {
    rejects({ ...fallback(), sources: [{ ...embed(), embedUrl: url }] });
  }
  const url = "https://example.test/player?episode=2#start";
  assert.equal(parseSourcesResponse({ ...fallback(), sources: [{ ...embed(), embedUrl: url }] }).sources[0]?.type, "embed");
});

test("provider IDs and labels are bounded, distinct and nonempty", () => {
  for (const provider of ["", "a/b", "a b", "a".repeat(65), 3]) {
    rejects({ ...fallback(), sources: [{ ...embed(), provider }] });
  }
  for (const label of ["", "   ", "x".repeat(121), "bad\nlabel", "bad‮label", 3]) {
    rejects({ ...fallback(), sources: [{ ...embed(), label }] });
    mutateDirect((source) => { source.label = label; });
  }
  rejects({ ...fallback(), sources: [embed(), embed()] });
  rejects({ ...ready(), sources: [direct(), direct()] });
  const parsed = parseSourcesResponse({ ...fallback(), sources: [{ ...embed(), label: "  Example  " }] });
  assert.equal(parsed.sources[0]?.label, "Example");
});

test("video and subtitle URLs accept only opaque relative backend media paths", () => {
  for (const url of ["https://cdn.example.test/video.mp4", "https://backend.example.test/media/token",
    "http://localhost:8787/media/token", "//backend.example.test/media/token", "/api/media/token",
    "/media/", "/media/.", "/media/..", "/media/a/b", "/media/%2e%2e", "/media/a%2Fb",
    "/media/token?key=value", "/media/token#fragment", "/media/token=", "/media/token+", "/media/token\\other",
    "/media/.token", "/media/token.", "/media/a..b", `/media/${"a".repeat(161)}`]) {
    const value = ready();
    const source = value.sources[0] as ReturnType<typeof direct>;
    source.qualities[0]!.url = url;
    rejects(value);
    const subtitleValue = ready();
    (subtitleValue.sources[0] as ReturnType<typeof direct>).subtitles[0]!.url = url;
    rejects(subtitleValue);
  }
});

test("expiry is safe millisecond metadata with a bounded deterministic renewal window", () => {
  for (const invalidTime of [NaN, Infinity, -Infinity, 0, -1, 1.5, "1000000", Number.MAX_SAFE_INTEGER, null]) {
    mutateDirect((source) => { source.expiresAt = invalidTime; });
    mutateDirect((source) => { source.renewAt = invalidTime; });
  }
  mutateDirect((source) => { source.renewAt = source.expiresAt; });
  mutateDirect((source) => { source.renewAt = 1_000_001; });
  mutateDirect((source) => { source.renewAt = 399_999; });
  const value = ready();
  (value.sources[0] as ReturnType<typeof direct>).renewAt = 400_000;
  assert.equal(parseSourcesResponse(value).sources[0]?.type, "direct");
  // Deliberately past timestamps remain valid JSON; expiry belongs to the UI.
  const past = ready();
  Object.assign(past.sources[0]!, { renewAt: 1, expiresAt: 2 });
  assert.equal(parseSourcesResponse(past).sources[0]?.type, "direct");
});

test("quality lists require nonempty bounded actual distinct options", () => {
  for (const qualities of [[], null, "720p", Array(1), Array.from({ length: 17 }, (_, index) => ({
    id: `q${index}`, label: `${index}p`, url: `/media/token${index}`,
  }))]) mutateDirect((source) => { source.qualities = qualities; });
  for (const field of ["id", "url", "label"] as const) {
    const value = ready();
    const source = value.sources[0] as ReturnType<typeof direct>;
    source.qualities[1]![field] = source.qualities[0]![field];
    rejects(value);
  }
  for (const height of [0, -1, 720.5, Infinity, "720", 16_385]) {
    mutateDirect((source) => { source.qualities = [{ ...direct().qualities[0], height }]; });
  }
  mutateDirect((source) => { source.qualities = [{ ...direct().qualities[0], label: "Auto" }]; });
  mutateDirect((source) => { source.qualities = [{ ...direct().qualities[0], id: "a/b" }]; });
  const value = ready();
  Object.assign(value.sources[0]!, { qualities: [{ id: "native", label: "Source", url: capability() }] });
  assert.equal(parseSourcesResponse(value).sources[0]?.type, "direct");
});

test("subtitle/audio lists require valid IDs, languages, membership and bounds", () => {
  for (const lang of ["", "English language", "en_US", "en-", "a", "x".repeat(36), 3]) {
    mutateDirect((source) => { source.subtitles = [{ ...direct().subtitles[0], lang }]; });
    mutateDirect((source) => { source.audios = [{ ...direct().audios[0], lang }]; });
  }
  mutateDirect((source) => { source.subtitles = [{ ...direct().subtitles[0], id: "off" }]; });
  mutateDirect((source) => { source.subtitles = [direct().subtitles[0], direct().subtitles[0]]; });
  mutateDirect((source) => { source.subtitles = Array(1); });
  mutateDirect((source) => { source.subtitles = Array(33).fill(direct().subtitles[0]); });
  mutateDirect((source) => { source.audios = []; });
  mutateDirect((source) => { source.audios = null; });
  mutateDirect((source) => { source.audios = Array(17).fill(direct().audios[0]); });
  mutateDirect((source) => { source.audios = [direct().audios[0], direct().audios[0]]; });
  mutateDirect((source) => { source.selectedAudio = "not_an_available_audio"; });
  mutateDirect((source) => { source.sessionId = ""; });
  const value = ready();
  const source = value.sources[0] as ReturnType<typeof direct>;
  source.subtitles = [];
  source.audios.push({ id: "verified_dub", label: "French", lang: "fr-CA" });
  assert.deepEqual(parseSourcesResponse(value), value);
});

test("oversized source lists and sparse entries fail", () => {
  rejects({ ...fallback(), sources: Array(1) });
  rejects({ ...fallback(), sources: Array.from({ length: 17 }, (_, index) => ({ ...embed(), provider: `embed${index}` })) });
});

test("parsing returns detached public data without private or unknown metadata", () => {
  const value = ready();
  const source = value.sources[0] as ReturnType<typeof direct>;
  Object.assign(value, { secret: "ignored" });
  Object.assign(source, { upstreamUrl: "https://cdn.example.test/private", headers: { Cookie: "private" }, timelineAligned: true });
  Object.assign(source.qualities[0]!, { upstreamUrl: "private" });
  const parsed = parseSourcesResponse(value);
  assert.deepEqual(Object.keys(parsed).sort(), ["moviebox", "sources", "version"]);
  const publicSource = parsed.sources[0];
  assert.ok(publicSource?.type === "direct");
  assert.equal("upstreamUrl" in publicSource, false);
  assert.equal("headers" in publicSource, false);
  assert.equal("timelineAligned" in publicSource, false);
  assert.equal("upstreamUrl" in publicSource.qualities[0]!, false);
  source.qualities[0]!.label = "Changed after parsing";
  assert.equal(publicSource.qualities[0]!.label, "720p");
});
