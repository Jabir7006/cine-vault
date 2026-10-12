import assert from "node:assert/strict";
import test from "node:test";
import { sources } from "../src/routes/sources";
import { episodeParam, isMediaId } from "../src/validation";

test("media IDs must be positive decimal strings bounded to 20 digits", () => {
  for (const value of ["27205", "0001", "99999999999999999999"]) assert.equal(isMediaId(value), true);
  for (const value of ["0", "000", "-1", "1.5", "abc", "", "1".repeat(21)]) assert.equal(isMediaId(value), false);
});

test("episode parameters default only when absent and reject invalid values", () => {
  assert.equal(episodeParam(undefined, 99), 1);
  assert.equal(episodeParam("99", 99), 99);
  for (const value of ["0", "-1", "1.5", "Infinity", "", "100", "1e1", " 1"]) {
    assert.equal(episodeParam(value, 99), undefined);
  }
});

test("sources reject invalid routes without contacting upstreams", async () => {
  for (const path of ["/other/123", "/movie/0", "/tv/1399?s=-1", "/tv/1399?e=Infinity", "/tv/1399?e=10000"]) {
    const response = await sources.request(path);
    assert.equal(response.status, 400, path);
  }
});

test("movie and valid TV sources preserve current iframe candidates", async () => {
  const movie = await sources.request("/movie/27205?s=-1&e=Infinity");
  assert.equal(movie.status, 200);
  const movieBody = await movie.json() as { sources: { type: string; provider: string; embedUrl: string }[] };
  assert.deepEqual(movieBody.sources.map((source) => source.provider), [
    "embedwave.cc", "vidcore.org", "vidsrc.to", "vidlink", "2embed",
  ]);
  assert.ok(movieBody.sources.every((source) => source.type === "embed"));
  assert.ok(movieBody.sources.some((source) => source.provider === "vidcore.org"));
  assert.equal(movieBody.sources.find((source) => source.provider === "vidsrc.to")?.embedUrl,
    "https://vidsrc.to/embed/movie/27205");

  const tv = await sources.request("/tv/1399?s=2&e=3");
  assert.equal(tv.status, 200);
  const tvBody = await tv.json() as { sources: { provider: string; embedUrl: string }[] };
  assert.equal(tvBody.sources.find((source) => source.provider === "vidsrc.to")?.embedUrl,
    "https://vidsrc.to/embed/tv/1399/2/3");
});
