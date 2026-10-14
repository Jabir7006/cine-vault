import assert from "node:assert/strict";
import test from "node:test";
import { hasEpisodeEvidence, identityMatches, matchMovieBoxSubject, normalizeTitle, selectCandidates } from "../src/moviebox/matching.js";
import type { MatchingMetadata, Target } from "../src/moviebox/matching.js";
import type { SubjectDetail, SubjectIdentity } from "../src/moviebox/metadata.js";
import { cleanMovieBoxTitle } from "../src/moviebox/metadata.js";
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
test("cleanMovieBoxTitle strips release tags, resolutions, language suffixes and season markers", () => {
  assert.equal(cleanMovieBoxTitle("[Dub] Inception"), "Inception");
  assert.equal(cleanMovieBoxTitle("[RAW] [1080p] Interstellar"), "Interstellar");
  assert.equal(cleanMovieBoxTitle("Dune [2021]"), "Dune");
  assert.equal(cleanMovieBoxTitle("Movie - Hindi Dub"), "Movie");
  assert.equal(cleanMovieBoxTitle("Breaking Bad S01"), "Breaking Bad");
  assert.equal(cleanMovieBoxTitle("Dark Season 2"), "Dark");
  assert.equal(cleanMovieBoxTitle("Ek Deewane Ki Deewaniyat_360P"), "Ek Deewane Ki Deewaniyat");
  assert.equal(cleanMovieBoxTitle("Inception (2010)"), "Inception (2010)");
  assert.equal(cleanMovieBoxTitle("Movie (Director's Cut)"), "Movie");
  assert.equal(cleanMovieBoxTitle("Movie - English Audio"), "Movie");
  assert.equal(cleanMovieBoxTitle(""), "");
  assert.equal(cleanMovieBoxTitle("   "), "");
});
test("decorated row titles match through the same cleaning used for confirmation", () => {
  // MovieBox decorates rows with release tags, language markers and season suffixes.
  // Search filtering and identity confirmation now share one cleaning rule, so a
  // decorated row is a usable candidate instead of being discarded as a mismatch.
  const rawDub: SubjectIdentity = { subjectId: "2", title: "[Dub] Film 2", type: "movie", year: 2024 };
  assert.deepEqual(selectCandidates([rawDub], target), { status: "candidates", subjects: [rawDub] });
  // An undecorated title outranks its decorated duplicate; both stay usable.
  assert.deepEqual(selectCandidates([rawDub, candidate], target), { status: "candidates", subjects: [candidate, rawDub] });
  assert.deepEqual(selectCandidates([{ ...rawDub, year: 2023 }], target), { status: "not_found" });
});
test("exact year matches are preferred over year-unknown candidates", () => {
  // Candidates with year mismatch never pass identityMatches (year is part of strict identity).
  const wrongYear: SubjectIdentity = { subjectId: "2", title: "Film 2", type: "movie", year: 2023 };
  assert.deepEqual(selectCandidates([wrongYear, { ...wrongYear, subjectId: "3" }], target), { status: "not_found" });
  // Duplicate exact matches are all returned, ordered so verification is deterministic.
  assert.deepEqual(selectCandidates([candidate, { ...candidate, subjectId: "2" }], target),
    { status: "candidates", subjects: [{ ...candidate, subjectId: "2" }, candidate] });
  assert.deepEqual(selectCandidates([candidate, wrongYear], target), { status: "candidates", subjects: [candidate] });
});
test("canonical or original exact title, type and year all must agree", () => {
  assert.equal(identityMatches({ ...candidate, title: "  Ｆilm ２ " }, target), true);
  assert.equal(identityMatches({ ...candidate, title: "original: FILM 2" }, target), true);
  for (const row of [{ ...candidate, title: "Film" }, { ...candidate, title: "Film 20" }, { ...candidate, title: "Film-2" },
    { ...candidate, type: "tv" as const }, { ...candidate, year: 2023 }, { ...candidate, title: undefined },
    { ...candidate, year: undefined }, { ...candidate, type: undefined }, { ...candidate, subjectId: "0" }]) assert.equal(identityMatches(row, target), false);
});
test("selection deduplicates consistent IDs and bounds duplicate fan-out", () => {
  assert.deepEqual(selectCandidates([candidate, candidate, { ...candidate, subjectId: "2", year: 2023 }], target),
    { status: "candidates", subjects: [candidate] });
  const tie = selectCandidates([candidate, { ...candidate, subjectId: "2" }], target);
  assert.equal(tie.status, "candidates");
  if (tie.status === "candidates") assert.deepEqual(tie.subjects.map((row) => row.subjectId), ["2", candidate.subjectId]);
  // A duplicate flood is truncated so detail fan-out can never grow with result size.
  const flood = selectCandidates(Array.from({ length: 9 }, (_, index) => ({ ...candidate, subjectId: String(index + 1) })), target);
  assert.equal(flood.status, "candidates");
  if (flood.status === "candidates") assert.equal(flood.subjects.length, 3);
  assert.deepEqual(selectCandidates([{ ...candidate, year: 2023 }], target), { status: "not_found" });
  assert.deepEqual(selectCandidates([], target), { status: "not_found" });
});
test("missing identity evidence never supplies a candidate or silently hides plausible alternatives", () => {
  for (const row of [{ ...candidate, year: undefined }, { ...candidate, type: undefined }, { ...candidate, subjectId: "0" }]) {
    assert.deepEqual(selectCandidates([row], target), { status: "unverified" });
    assert.deepEqual(selectCandidates([candidate, row], target), { status: "unverified" });
  }
  assert.deepEqual(selectCandidates([{ ...candidate, title: undefined }], target), { status: "not_found" });
  assert.deepEqual(selectCandidates([candidate, { ...candidate, year: 2020 }], target), { status: "unverified" });
});
test("matching searches distinct canonical/original titles and reconfirms the exact string ID", async () => {
  const { metadata, searches, details } = fixture([candidate]);
  assert.deepEqual(await matchMovieBoxSubject(metadata, target), { status: "matched", subject: detail, alternates: [] });
  assert.deepEqual(searches, target.titles);
  assert.deepEqual(details, [candidate.subjectId]);
});
test("normalized duplicate queries issue one search, first page only", async () => {
  const { metadata, searches } = fixture([candidate]);
  assert.equal((await matchMovieBoxSubject(metadata, { ...target, titles: ["Film 2", " ＦILM ２ "] })).status, "matched");
  assert.deepEqual(searches, ["Film 2"]);
});
test("duplicate subjects are reconfirmed by detail with bounded fan-out", async () => {
  // Two title queries each yield a distinct duplicate ID; both are reconfirmed by detail.
  let searched = 0;
  const detailed: string[] = [];
  const result = await matchMovieBoxSubject({ search: async () => [{ ...candidate, subjectId: String(++searched) }],
    detail: async (id) => { detailed.push(id); return { ...detail, subjectId: id }; } }, target);
  assert.equal(result.status, "matched");
  assert.deepEqual(detailed, ["1", "2"]);
  // A flood of agreeing duplicates is truncated: detail fan-out never scales with results.
  const flood: string[] = [];
  const many = await matchMovieBoxSubject({ search: async () => Array.from({ length: 9 }, (_, index) => ({ ...candidate, subjectId: String(index + 1) })),
    detail: async (id) => { flood.push(id); return { ...detail, subjectId: id }; } }, target);
  assert.equal(many.status, "matched");
  assert.equal(flood.length, 3);
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
test("matching failure callbacks preserve exact fixed stage and cannot alter propagation or gates", async () => {
  const events: unknown[] = [];
  const failure = new MovieBoxError("denied", 403);
  await assert.rejects(matchMovieBoxSubject({ search: async () => [candidate], detail: async () => { throw failure; } }, target,
    (event) => { events.push(event); }), (error) => error === failure);
  assert.deepEqual(events.slice(), [{ stage: "detail", code: "denied", httpStatus: 403 }]);
  await assert.rejects(matchMovieBoxSubject({ search: async () => { throw new Error("https://private.example/?token=private"); },
    detail: async () => detail }, target, (event) => { events.push(event); }), Error);
  assert.deepEqual(events[1], { stage: "matching", code: "unknown" });
  const f = fixture([{ ...candidate, year: undefined }]);
  assert.deepEqual(await matchMovieBoxSubject(f.metadata, target, () => { throw new Error("private logging error"); }), { status: "unverified" });
  assert.equal(f.details.length, 0);
});

test("season rows sharing one series ID are not a contradictory identity", () => {
  const series: Target = { type: "tv", titles: ["Synthetic Series"], year: 2008 };
  const rows: SubjectIdentity[] = [
    { subjectId: "7", title: "Synthetic Series S1", type: "tv", year: 2008 },
    { subjectId: "7", title: "Synthetic Series S2", type: "tv", year: 2009 },
    { subjectId: "7", title: "Synthetic Series S5", type: "tv", year: 2012 },
  ];
  // The season rows clean to the series title; only the first-air year row matches, and
  // the differing years must not be read as one ID contradicting itself.
  assert.deepEqual(selectCandidates(rows, series), { status: "candidates", subjects: [rows[0]] });
  // A film carries exactly one release year, so a second year for the same ID still fails.
  assert.deepEqual(selectCandidates([candidate, { ...candidate, year: 2020 }], target), { status: "unverified" });
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
test("an explicit episode list is authoritative and maxEp is never stretched past itself", () => {
  // MovieBox reports most seasons with only a highest-episode bound, so 1..maxEp is the season.
  const bounded = [{ se: 1, episodeNumbers: [], maxEp: 15 }];
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 1 }, bounded), true);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 15 }, bounded), true);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 16 }, bounded), false);
  assert.equal(hasEpisodeEvidence({ season: 2, episode: 1 }, bounded), false);
  // A season that lists its episodes never gains the ones it omits.
  const gapped = [{ se: 1, episodeNumbers: [1, 2, 4, 5, 6, 7], maxEp: 7 }];
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 4 }, gapped), true);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 3 }, gapped), false);
  // No bound and no list is no evidence; array positions and other episodes' resources never prove.
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 1 }, [{ se: 1, episodeNumbers: [] }]), false);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 13 }, [{ se: 1, episodeNumbers: [], maxEp: 12 }], [{ se: 1, ep: 13 }]), true);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 13 }, [{ se: 1, episodeNumbers: [], maxEp: 12 }], [{ se: 2, ep: 13 }, { se: 1, ep: 12 }, {}]), false);
  assert.equal(hasEpisodeEvidence({ season: 0, episode: 1 }, bounded), false);
  assert.equal(hasEpisodeEvidence({ season: 1, episode: 10001 }, bounded), false);
});
test("explicit dubs remain metadata, not manufactured ready audio choices", async () => {
  const withDubs: SubjectDetail = { ...detail, dubs: [{ subjectId: "8", title: "Unverified alternate", lang: "bn" }] };
  const result = await matchMovieBoxSubject(fixture([candidate], withDubs).metadata, target);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.deepEqual(result.subject.dubs, withDubs.dubs);
  assert.equal("audio" in result, false);
});
