import assert from "node:assert/strict";
import test from "node:test";
import {
  filterEpisodes,
  getAdjacentEpisodes,
  getCalendarDate,
  getEpisodeRating,
  getSupportedSeasons,
  hasSelectedEpisode,
  isUpcomingEpisode,
  parseSeasonMetadata,
} from "../../frontend/src/features/watch/episodes";

const episode = (number = 1) => ({
  id: 123,
  season_number: 3,
  episode_number: number,
  name: "First episode",
  still_path: "/still.jpg",
  vote_average: 8.25,
  vote_count: 10,
  air_date: "2024-02-29",
  overview: "Overview",
  runtime: 45,
});
const season = (episodes: unknown[] = [episode()]) => ({
  id: 100,
  name: "Season three",
  season_number: 3,
  episodes,
});

test("supported seasons use actual noncontiguous numbers, omit specials, sort and deduplicate", () => {
  assert.deepEqual(getSupportedSeasons([
    { season_number: 9, name: "Ninth" },
    { season_number: 0, name: "Specials" },
    { season_number: 3, name: "" },
    { season_number: 99, name: null },
    { season_number: 100, name: "Unsupported" },
    { season_number: -1 },
    { season_number: 3, name: "  Third  " },
  ]), [
    { season_number: 3, name: "Third" },
    { season_number: 9, name: "Ninth" },
    { season_number: 99, name: "Season 99" },
  ]);
  assert.deepEqual(getSupportedSeasons([]), []);
  assert.deepEqual(getSupportedSeasons([{ season_number: 0 }]), []);
});

test("unknown or malformed season summaries cannot prove an invalid current season", () => {
  for (const value of [undefined, null, {}, "seasons", [null], [{ season_number: "1" }], [{ season_number: 1.5 }]]) {
    assert.equal(getSupportedSeasons(value), undefined);
  }
});

test("selected episode only matches successful metadata for the playing season", () => {
  const metadata = parseSeasonMetadata(season([episode(2), episode(8)]), 3);
  assert.equal(hasSelectedEpisode(metadata, 3, 8), true);
  assert.equal(hasSelectedEpisode(metadata, 3, 1), false);
  assert.equal(hasSelectedEpisode(metadata, 9, 8), undefined);
  assert.equal(hasSelectedEpisode(undefined, 3, 8), undefined);
  assert.equal(hasSelectedEpisode(parseSeasonMetadata(season([]), 3), 3, 1), false);
});

test("episode search trims whitespace, matches exact real numbers or case-insensitive titles", () => {
  const episodes = parseSeasonMetadata(season([
    { ...episode(2), name: "Chapter 8" },
    { ...episode(8), name: "The Return" },
    { ...episode(18), name: "RETURN to the city" },
  ]), 3).episodes;
  assert.equal(filterEpisodes(episodes, "  "), episodes);
  assert.deepEqual(filterEpisodes(episodes, " 8 ").map((item) => item.episode_number), [8]);
  assert.deepEqual(filterEpisodes(episodes, "008").map((item) => item.episode_number), [8]);
  assert.deepEqual(filterEpisodes(episodes, "2").map((item) => item.episode_number), [2]);
  assert.deepEqual(filterEpisodes(episodes, "18").map((item) => item.episode_number), [18]);
  assert.deepEqual(filterEpisodes(episodes, " ReTuRn ").map((item) => item.episode_number), [8, 18]);
  assert.deepEqual(filterEpisodes(episodes, "chapter").map((item) => item.episode_number), [2]);
  assert.deepEqual(filterEpisodes(episodes, "1"), []);
  assert.deepEqual(filterEpisodes(episodes, "missing"), []);
  assert.deepEqual(filterEpisodes(episodes, "8.0"), []);
  assert.deepEqual(filterEpisodes([], "8"), []);
  const tenAndHundred = parseSeasonMetadata(season([episode(10), episode(100)]), 3).episodes;
  assert.deepEqual(filterEpisodes(tenAndHundred, "10").map((item) => item.episode_number), [10]);
});

test("adjacency uses actual sparse episode metadata within the current season", () => {
  const metadata = parseSeasonMetadata(season([episode(18), episode(2), episode(8)]), 3);
  assert.deepEqual(getAdjacentEpisodes(metadata, 3, 8), {
    previous: metadata.episodes[0], next: metadata.episodes[2],
  });
  assert.deepEqual(getAdjacentEpisodes(metadata, 3, 2), {
    previous: undefined, next: metadata.episodes[1],
  });
  assert.deepEqual(getAdjacentEpisodes(metadata, 3, 18), {
    previous: metadata.episodes[1], next: undefined,
  });
  assert.deepEqual(getAdjacentEpisodes({ ...metadata, episodes: [...metadata.episodes].reverse() }, 3, 8), {
    previous: metadata.episodes[0], next: metadata.episodes[2],
  });
});

test("missing playback, unknown metadata and mismatched seasons have no neighbors", () => {
  const metadata = parseSeasonMetadata(season([episode(2), episode(8)]), 3);
  for (const result of [
    getAdjacentEpisodes(metadata, 3, 1),
    getAdjacentEpisodes(metadata, 3, 5),
    getAdjacentEpisodes(metadata, 9, 2),
    getAdjacentEpisodes(undefined, 3, 2),
    getAdjacentEpisodes(parseSeasonMetadata(season([]), 3), 3, 2),
    getAdjacentEpisodes(parseSeasonMetadata(season([episode(2)]), 3), 3, 2),
  ]) assert.deepEqual(result, { previous: undefined, next: undefined });
});

test("upcoming adjacent targets stay adjacent so the controller can disable them, not skip", () => {
  const metadata = parseSeasonMetadata(season([
    episode(2), { ...episode(8), air_date: "2026-10-13" }, episode(18),
  ]), 3);
  const next = getAdjacentEpisodes(metadata, 3, 2).next;
  assert.equal(next?.episode_number, 8);
  assert.equal(isUpcomingEpisode(next?.air_date, "2026-10-12"), true);
  const previous = getAdjacentEpisodes(metadata, 3, 18).previous;
  assert.equal(previous?.episode_number, 8);
  assert.equal(isUpcomingEpisode(previous?.air_date, "2026-10-12"), true);
  assert.equal(isUpcomingEpisode({ ...episode(8), air_date: null }.air_date, "2026-10-12"), false);
});

test("calendar dates validate leap days and reject malformed or normalized dates", () => {
  assert.equal(getCalendarDate("2024-02-29"), "2024-02-29");
  for (const value of [undefined, null, "", "2023-02-29", "2024-02-30", "2024-13-01", "2024-00-01", "2024-01-00", "2024-2-01", "2024-01-01T00:00:00Z", "unknown"]) {
    assert.equal(getCalendarDate(value), null);
  }
});

test("upcoming uses UTC calendar comparison and unknown dates remain selectable", () => {
  assert.equal(isUpcomingEpisode("2026-10-13", "2026-10-12"), true);
  assert.equal(isUpcomingEpisode("2026-10-12", "2026-10-12"), false);
  assert.equal(isUpcomingEpisode("2026-10-11", "2026-10-12"), false);
  assert.equal(isUpcomingEpisode("2027-01-01", "2026-12-31"), true);
  for (const value of [null, "", "2026-02-30", "bad"]) {
    assert.equal(isUpcomingEpisode(value, "2026-10-12"), false);
  }
  assert.equal(isUpcomingEpisode("2026-10-13", "bad"), false);
});

test("ratings need votes, preserve zero ratings and format one decimal", () => {
  assert.equal(getEpisodeRating({ vote_average: 8.25, vote_count: 10 }), "8.3");
  assert.equal(getEpisodeRating({ vote_average: 0, vote_count: 1 }), "0.0");
  for (const input of [
    { vote_average: 8, vote_count: 0 },
    { vote_average: 8, vote_count: null },
    { vote_average: null, vote_count: 1 },
    { vote_average: NaN, vote_count: 1 },
    { vote_average: Infinity, vote_count: 1 },
    { vote_average: 11, vote_count: 1 },
    { vote_average: -1, vote_count: 1 },
    { vote_average: 8, vote_count: -1 },
  ]) assert.equal(getEpisodeRating(input), "Not rated");
});

test("metadata validation keeps real episode numbers, optional fields and empty lists", () => {
  const parsed = parseSeasonMetadata(season([episode(8), episode(2)]), 3);
  assert.deepEqual(parsed.episodes.map((item) => item.episode_number), [2, 8]);
  assert.deepEqual(parsed.episodes[0], episode(2));
  assert.deepEqual(parseSeasonMetadata(season([]), 3).episodes, []);
  const normalized = parseSeasonMetadata(season([{
    season_number: 3, episode_number: 4, name: null, still_path: "https://other/still.jpg",
    vote_average: "8", vote_count: "10", air_date: "2023-02-29", runtime: 0,
  }]), 3).episodes[0];
  assert.deepEqual(normalized, {
    id: null, season_number: 3, episode_number: 4, name: "Episode 4", still_path: null,
    vote_average: null, vote_count: null, air_date: null, overview: "", runtime: null,
  });
});

test("malformed or mismatching payloads fail rather than masquerading as empty metadata", () => {
  for (const value of [
    null, [], {}, { season_number: 3 }, { season_number: 3, episodes: null },
    { season_number: 2, episodes: [] }, season([null]),
    season([{ ...episode(), season_number: 2 }]),
    season([{ ...episode(), episode_number: "1" }]),
    season([{ ...episode(), episode_number: 0 }]),
    season([{ ...episode(), episode_number: 10000 }]),
    season([episode(), episode()]),
  ]) assert.throws(() => parseSeasonMetadata(value, 3), /metadata/);
  assert.throws(() => parseSeasonMetadata(season(), 0), /metadata/);
});
