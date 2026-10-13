import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError } from "../../frontend/node_modules/axios/index.js";
import { getEmbedSources } from "../src/providers/embed.ts";
import { getFallbackEmbedSources, sourcesWithEmbedFallback } from "../../frontend/src/features/watch/embed-fallback.ts";
import { discoveryFailure, discoveryFailureMessage, SourcesDiscoveryError, SOURCES_TIMEOUT_MS } from "../../frontend/src/features/watch/discovery-error.ts";
import { movieBoxPresentation } from "../../frontend/src/features/watch/moviebox-status.ts";
import { resolveOwnedSource, resolveSource } from "../../frontend/src/features/watch/playback.ts";
import { parseSourcesResponse } from "../../frontend/src/features/watch/source-response.ts";
import type { DirectSource } from "../../frontend/src/features/watch/types.ts";

const direct: DirectSource = {
  type: "direct", provider: "moviebox", label: "MovieBox", format: "progressive",
  sessionId: "synthetic", issuedAt: 400_000, revision: 1, controlToken: "C".repeat(42) + "A",
  controlExpiresAt: 1_030_000, renewAt: 900_000, expiresAt: 1_000_000,
  qualities: [{ id: "q720", label: "720p", url: `/media/v1.video.GET-HEAD.${"A".repeat(32)}.1000000.${"B".repeat(43)}` }],
  subtitles: [], audios: [{ id: "original", label: "Original", lang: "en" }], selectedAudio: "original",
};
const order = ["embedwave.cc", "vidcore.org", "vidsrc.to", "vidlink", "2embed"];

test("offline movie/TV candidates exactly match backend provider order, labels and URLs", () => {
  for (const type of ["movie", "tv"] as const) {
    for (const id of ["278", "000123", "12345678901234567890"]) {
      for (const [season, episode] of [[1, 1], [2, 3], [99, 9999]]) {
        const local = getFallbackEmbedSources(type, id, season, episode);
        assert.deepEqual(local, getEmbedSources(type, id, { season, episode }));
        assert.deepEqual(local.map((source) => source.provider), order);
        assert.ok(local.every((source) => source.type === "embed"));
      }
    }
  }
  assert.deepEqual(getFallbackEmbedSources("tv", "278"), getEmbedSources("tv", "278"));
});

test("fallback construction fails closed for invalid context and URL injection", () => {
  for (const id of ["", "0", "000", "-1", "1.2", "1e3", " 278", "278\n", "1".repeat(21), "278/path", "278?url=https://evil.test", "278&s=2", "<script>"]) {
    assert.deepEqual(getFallbackEmbedSources("movie", id), []);
    assert.deepEqual(getFallbackEmbedSources("tv", id), []);
  }
  for (const type of ["", "other", "movie/../../", "TV"]) assert.deepEqual(getFallbackEmbedSources(type, "278"), []);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, "2" as unknown as number]) {
    assert.deepEqual(getFallbackEmbedSources("tv", "278", value, 1), []);
    assert.deepEqual(getFallbackEmbedSources("tv", "278", 1, value), []);
  }
  assert.deepEqual(getFallbackEmbedSources("tv", "278", 100, 1), []);
  assert.deepEqual(getFallbackEmbedSources("tv", "278", 1, 10000), []);
});

test("initial pending discovery does not select an embed ahead of primary MovieBox", () => {
  assert.deepEqual(sourcesWithEmbedFallback(undefined, false, "movie", "278"), []);
  const ready = parseSourcesResponse({ version: 2, moviebox: { status: "ready" }, sources: [direct, ...getEmbedSources("movie", "278")] });
  assert.equal(resolveSource(sourcesWithEmbedFallback(ready.sources, false, "movie", "278"))?.type, "direct");
});

test("whole discovery failure leaves usable selectable embeds and no fake MovieBox readiness", () => {
  const sources = sourcesWithEmbedFallback(undefined, true, "movie", "278");
  assert.deepEqual(sources.map((source) => source.provider), order);
  assert.equal(resolveSource(sources)?.provider, "embedwave.cc");
  assert.equal(resolveSource(sources, "vidlink")?.type, "embed");
  assert.equal(sources.some((source) => source.type === "direct"), false);
  const presentation = movieBoxPresentation(undefined, false, false, true);
  assert.equal(presentation.available, false);
  assert.match(presentation.message, /status could not be checked/);
  assert.doesNotMatch(presentation.message, /verified direct source available/);
});

test("refetch error preserves cached and committed direct ownership plus preference", () => {
  const sources = sourcesWithEmbedFallback([direct], true, "movie", "278");
  assert.equal(sources[0], direct);
  assert.equal(resolveOwnedSource(sources, "vidlink", direct), direct);
  assert.equal(resolveOwnedSource(sourcesWithEmbedFallback(undefined, true, "movie", "278"), "vidlink", direct), direct);
  assert.equal(resolveSource(sources, "vidlink")?.provider, "vidlink");
  const embeds = getFallbackEmbedSources("movie", "278");
  assert.deepEqual(sourcesWithEmbedFallback(embeds, true, "movie", "278"), embeds);
  // A preference absent from error fallbacks is not discarded; it works again on retry.
  assert.equal(resolveSource(embeds, "moviebox")?.type, "embed");
  assert.equal(resolveSource([direct, ...embeds], "moviebox"), direct);
});

test("fallback context is regenerated per TV episode and does not reuse an old episode URL", () => {
  const first = sourcesWithEmbedFallback(undefined, true, "tv", "278", 2, 1);
  const next = sourcesWithEmbedFallback(undefined, true, "tv", "278", 2, 2);
  const selectedFirst = resolveSource(first, "vidlink");
  const selectedNext = resolveSource(next, "vidlink");
  assert.ok(selectedFirst?.type === "embed" && selectedNext?.type === "embed");
  assert.notEqual(selectedFirst.embedUrl, selectedNext.embedUrl);
  assert.deepEqual(next, getEmbedSources("tv", "278", { season: 2, episode: 2 }));
});

test("strict parser still rejects unsafe direct capabilities; error fallbacks are independently generated", () => {
  assert.throws(() => parseSourcesResponse({ version: 2, moviebox: { status: "ready" },
    sources: [{ ...direct, qualities: [{ id: "q720", label: "720p", url: "https://evil.test/private" }] }] }));
  const fallback = sourcesWithEmbedFallback(undefined, true, "movie", "278");
  assert.ok(fallback.every((source) => source.type === "embed" && !source.embedUrl.includes("evil.test")));
});

test("bounded discovery errors distinguish timeout, network, HTTP, parser and unknown request failures", () => {
  assert.equal(SOURCES_TIMEOUT_MS, 15_000);
  const failures = [
    [new AxiosError("private URL/token", "ECONNABORTED"), "timeout"],
    [new AxiosError("private URL/token", "ETIMEDOUT"), "timeout"],
    [new AxiosError("private URL/token", "ERR_NETWORK"), "network"],
    [new AxiosError("private URL/token", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503 } as never), "http"],
    [new SourcesDiscoveryError("malformed"), "malformed"],
    [new AxiosError("private URL/token", "ERR_CANCELED"), "cancelled"],
    [new Error("private URL/token"), "request"],
  ] as const;
  for (const [error, kind] of failures) {
    assert.equal(discoveryFailure(error).kind, kind);
    const message = discoveryFailureMessage(error, true);
    assert.doesNotMatch(message, /private|token|URL/);
    assert.match(message, /Embed providers can still be selected; playback is not guaranteed/);
    assert.ok(message.length < 240);
  }
  const messages = ["timeout", "network", "http", "malformed", "cancelled", "request"] as const;
  assert.equal(new Set(messages.map((kind) => discoveryFailureMessage(new SourcesDiscoveryError(kind), true))).size, messages.length);
});

test("status messages never claim embed availability without actual candidates", () => {
  assert.match(movieBoxPresentation({ status: "unavailable" }, false, false, false).message, /No embed fallback candidates are available/);
  assert.doesNotMatch(movieBoxPresentation(undefined, false, false, false).message, /fallback.*available/);
  assert.match(discoveryFailureMessage(new SourcesDiscoveryError("http"), false), /No embed fallback candidates are available/);
  assert.match(movieBoxPresentation({ status: "unavailable" }, false, false, true).message, /playback is not guaranteed/);
});
