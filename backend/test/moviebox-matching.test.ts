import assert from "node:assert/strict";
import test from "node:test";
import { hasEpisodeEvidence, identityMatches, matchMovieBoxSubject, normalizeTitle, selectUniqueCandidate } from "../src/moviebox/matching.js";
import type { MatchingMetadata, Target } from "../src/moviebox/matching.js";
import type { SubjectDetail, SubjectIdentity } from "../src/moviebox/metadata.js";
import { MovieBoxError } from "../src/moviebox/errors.js";

const target: Target = { type: "movie", titles: ["Film 2", "Original: Film 2"], year: 2024 };
const candidate: SubjectIdentity = { subjectId: "900719925474099312345", title: "Film 2", type: "movie", year: 2024 };
const detail: SubjectDetail = { ...candidate, seasons: [], dubs: [] };
function fixture(rows: SubjectIdentity[], result: SubjectDetail | undefined = detail) {
  const searches: string[] = [];
  const details: string[] = [];
  const metadata: MatchingMetadata = { search: async (query, page) => { assert.equal(page, 1); searches.push(query); return rows; },
    detail: async (id) => { details.push(id); return result; } };
  return { metadata, searches, details };
}

test("Unicode NFKC/case/whitespace normalization preserves digits/punctuation and meaningful text", () => {
  assert.equal(normalizeTitle("  ＦＩＬＭ   ２ "), "film 2");
  assert.equal(normalizeTitle("Café: Part 2"), "café: part 2");
  assert.notEqual(normalizeTitle("Film 2"), normalizeTitle("Film"));
  assert.notEqual(normalizeTitle("Film: 2"), normalizeTitle("Film 2"));
  assert.notEqual(normalizeTitle("Amélie"), normalizeTitle("Amelie"));
  assert.notEqual(normalizeTitle("Spider-Man"), normalizeTitle("Spider Man"));
  assert.equal(normalizeTitle("বাংলা ২"), "বাংলা ২");
});
test("canonical or original exact title, type and year all must agree", () => {
  assert.equal(identityMatches({ ...candidate, title: "  Ｆilm ２ " }, target), true);
  assert.equal(identityMatches({ ...candidate, title: "original: FILM 2" }, target), true);
  for (const row of [{ ...candidate, title: "Film" }, { ...candidate, title: "Film 20" }, { ...candidate, title: "Film-2" },
    { ...candidate, type: "tv" as const }, { ...candidate, year: 2023 }, { ...candidate, title: undefined },
    { ...candidate, year: undefined }, { ...candidate, type: undefined }, { ...candidate, subjectId: "0" }]) assert.equal(identityMatches(row, target), false);
});
test("unique selection deduplicates consistent IDs but rejects remakes and ambiguity", () => {
  assert.equal(selectUniqueCandidate([candidate, candidate, { ...candidate, subjectId: "2", year: 2023 }], target).status, "candidate");
  assert.deepEqual(selectUniqueCandidate([candidate, { ...candidate, subjectId: "2" }], target), { status: "ambiguous" });
  assert.deepEqual(selectUniqueCandidate([{ ...candidate, year: 2023 }], target), { status: "not_found" });
  assert.deepEqual(selectUniqueCandidate([], target), { status: "not_found" });
});
test("missing identity evidence never supplies a candidate or silently hides plausible alternatives", () => {
  for (const row of [{ ...candidate, year: undefined }, { ...candidate, type: undefined }, { ...candidate, subjectId: "0" }]) {
    assert.deepEqual(selectUniqueCandidate([row], target), { status: "unverified" });
    assert.deepEqual(selectUniqueCandidate([candidate, row], target), { status: "unverified" });
  }
  assert.deepEqual(selectUniqueCandidate([{ ...candidate, title: undefined }], target), { status: "not_found" });
  assert.deepEqual(selectUniqueCandidate([candidate, { ...candidate, year: 2020 }], target), { status: "unverified" });
});
test("matching searches distinct canonical/original titles and reconfirms the exact string ID", async () => {
  const { metadata, searches, details } = fixture([candidate]);
  assert.deepEqual(await matchMovieBoxSubject(metadata, target), { status: "matched", subject: detail });
  assert.deepEqual(searches, target.titles);
  assert.deepEqual(details, [candidate.subjectId]);
});
test("normalized duplicate queries issue one search, first page only", async () => {
  const { metadata, searches } = fixture([candidate]);
  assert.equal((await matchMovieBoxSubject(metadata, { ...target, titles: ["Film 2", " ＦILM ２ "] })).status, "matched");
  assert.deepEqual(searches, ["Film 2"]);
});
test("ambiguity across title queries blocks detail fan-out", async () => {
  let searched = 0;
  let detailed = 0;
  const result = await matchMovieBoxSubject({ search: async () => [{ ...candidate, subjectId: String(++searched) }],
    detail: async () => { detailed++; return detail; } }, target);
  assert.deepEqual(result, { status: "ambiguous" });
  assert.equal(detailed, 0);
});
test("no matching candidate does not request any detail", async () => {
  const { metadata, details } = fixture([{ ...candidate, title: "Film 3" }]);
  assert.deepEqual(await matchMovieBoxSubject(metadata, target), { status: "not_found" });
  assert.deepEqual(details, []);
});
test("detail identity must reconfirm selected ID, title, type and year; no fallback to search evidence", async () => {
  for (const changed of [undefined, { ...detail, subjectId: "3" }, { ...detail, title: "Film 3" }, { ...detail, type: "tv" as const },
    { ...detail, year: 2023 }, { ...detail, year: undefined }, { ...detail, type: undefined }, { ...detail, title: undefined }]) {
    const f = fixture([candidate]);
    f.metadata.detail = async () => changed;
    assert.deepEqual(await matchMovieBoxSubject(f.metadata, target), { status: "unverified" });
  }
});
test("malformed target and bounded synthetic results fail closed before detail", async () => {
  for (const invalid of [{ ...target, year: 0 }, { ...target, year: 2024.5 }, { ...target, titles: [] }, { ...target, titles: [" "] },
    { ...target, titles: ["x".repeat(257)] }, { ...target, titles: ["Film\u00002"] }, { ...target, titles: Array(9).fill("Film 2") }]) {
    const f = fixture([candidate]);
    assert.deepEqual(await matchMovieBoxSubject(f.metadata, invalid), { status: "unverified" });
    assert.deepEqual(f.searches, []);
  }
  const f = fixture(Array(501).fill(candidate));
  assert.deepEqual(await matchMovieBoxSubject(f.metadata, target), { status: "unverified" });
  assert.deepEqual(f.details, []);
});
test("transport failure propagates to caller fallback without relabeling it as not found", async () => {
  const failure = new MovieBoxError("timeout");
  await assert.rejects(matchMovieBoxSubject({ search: async () => { throw failure; }, detail: async () => detail }, target), (error) => error === failure);
  await assert.rejects(matchMovieBoxSubject({ search: async () => [candidate], detail: async () => { throw failure; } }, target), (error) => error === failure);
});
test("TV identity is not a movie match, and exact episode proof is a separate gate", async () => {
  const tv: SubjectDetail = { ...detail, type: "tv", seasons: [{ se: 2, episodeNumbers: [3, 9], maxEp: 20 }] };
  const tvTarget: Target = { ...target, type: "tv" };
  assert.equal((await matchMovieBoxSubject(fixture([tv], tv).metadata, tvTarget)).status, "matched");
  assert.equal((await matchMovieBoxSubject(fixture([tv], tv).metadata, target)).status, "not_found");
  assert.equal(hasEpisodeEvidence({ season: 2, episode: 9 }, tv.seasons), true);
  assert.equal(hasEpisodeEvidence({ season: 2, episode: 8 }, tv.seasons), false);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 9 }, tv.seasons), false);
});
test("maxEp alone/array positions/other resource episodes are never proof", () => {
  const seasons = [{ se: 1, episodeNumbers: [], maxEp: 15 }];
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 1 }, seasons), false);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 13 }, seasons, [{ se: 1, ep: 13 }]), true);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 13 }, seasons, [{ se: 2, ep: 13 }, { se: 1, ep: 12 }, {}]), false);
  assert.equal(hasEpisodeEvidence({ season: 0, episode: 1 }, seasons), false);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 10001 }, seasons), false);
});
test("explicit dubs remain metadata, not manufactured ready audio choices", async () => {
  const withDubs: SubjectDetail = { ...detail, dubs: [{ subjectId: "8", title: "Unverified alternate", lang: "bn" }] };
  const result = await matchMovieBoxSubject(fixture([candidate], withDubs).metadata, target);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.deepEqual(result.subject.dubs, withDubs.dubs);
  assert.equal("audio" in result, false);
});
