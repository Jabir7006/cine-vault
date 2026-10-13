import assert from "node:assert/strict";
import test from "node:test";
import { createTmdbLookup, parseTmdbIdentity } from "../src/moviebox/tmdb";

const data = { title: "Fixture Film 2", original_title: "Fixture Film 2", release_date: "2020-01-01" };

test("TMDB bridge preserves exact title/year/type evidence", () => {
  assert.deepEqual(parseTmdbIdentity(data, "movie"), { type: "movie", titles: ["Fixture Film 2"], year: 2020 });
  assert.equal(parseTmdbIdentity({ title: "Fixture", release_date: "" }, "movie"), undefined);
  assert.equal(parseTmdbIdentity(data, "tv"), undefined);
  assert.equal(parseTmdbIdentity({ ...data, release_date: "2020-02-30" }, "movie"), undefined);
  assert.deepEqual(parseTmdbIdentity({ name: "Series", original_name: "সিরিজ", first_air_date: "2022-03-04" }, "tv"), {
    type: "tv", titles: ["Series", "সিরিজ"], year: 2022,
  });
});

test("TMDB bridge refuses alternate origins and never accepts browser URLs", () => {
  for (const baseUrl of ["http://api.themoviedb.org/3", "https://example.com/3", "https://api.themoviedb.org/3?url=bad", "https://user:pass@api.themoviedb.org/3"]) {
    assert.throws(() => createTmdbLookup({ token: "fixture", baseUrl }));
  }
});

test("TMDB bridge sends server bearer token only to fixed endpoint and bounds response", async () => {
  let calls = 0;
  const lookup = createTmdbLookup({ token: "fixture-server-token", fetch: async (input, init) => {
    calls++;
    assert.equal(String(input), "https://api.themoviedb.org/3/movie/123?language=en-US");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-server-token");
    assert.equal(init?.redirect, "manual");
    return Response.json(data);
  } });
  assert.equal(await lookup("movie", "https://example.com"), undefined);
  assert.equal(calls, 0);
  assert.equal((await lookup("movie", "123"))?.year, 2020);
  const oversized = createTmdbLookup({ token: "fixture", fetch: async () => new Response("x".repeat(256 * 1024 + 1)) });
  await assert.rejects(oversized("movie", "123"), /TMDB lookup unavailable/);
});
