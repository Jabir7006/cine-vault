import type { TMDBSeasonSummary } from "../details/types/index";
import type { TMDBEpisode, TMDBSeasonMetadata } from "./types";

export type BrowsableSeason = Pick<TMDBSeasonSummary, "season_number" | "name">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

// Missing or malformed summaries are not evidence that the current season is invalid.
export const getSupportedSeasons = (value: unknown): BrowsableSeason[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  if (value.some((season) => !isRecord(season) || !Number.isInteger(season.season_number))) {
    return undefined;
  }

  const seasons = new Map<number, BrowsableSeason>();
  for (const season of value) {
    if (!isIntegerInRange(season.season_number, 1, 99)) continue;
    seasons.set(season.season_number, {
      season_number: season.season_number,
      name: typeof season.name === "string" && season.name.trim()
        ? season.name.trim()
        : `Season ${season.season_number}`,
    });
  }
  return [...seasons.values()].sort((a, b) => a.season_number - b.season_number);
};

// Compare validated calendar dates, not timezone-dependent local timestamps.
export const getCalendarDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
};

export const isUpcomingEpisode = (airDate: unknown, todayUTC: string): boolean => {
  const date = getCalendarDate(airDate);
  const today = getCalendarDate(todayUTC);
  return date !== null && today !== null && date > today;
};

export const getEpisodeRating = (
  episode: Pick<TMDBEpisode, "vote_average" | "vote_count">,
): string => {
  const { vote_average: rating, vote_count: votes } = episode;
  return typeof votes === "number" && Number.isInteger(votes) && votes > 0 &&
    typeof rating === "number" && Number.isFinite(rating) && rating >= 0 && rating <= 10
    ? rating.toFixed(1)
    : "Not rated";
};

const positiveId = (value: unknown): number | null =>
  isIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER) ? value : null;
const optionalText = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export const parseSeasonMetadata = (value: unknown, expectedSeason: number): TMDBSeasonMetadata => {
  if (!isIntegerInRange(expectedSeason, 1, 99) || !isRecord(value) ||
    value.season_number !== expectedSeason || !Array.isArray(value.episodes)) {
    throw new Error("Episode metadata is unavailable or malformed. Please try again.");
  }

  const seen = new Set<number>();
  const episodes = value.episodes.map((episode): TMDBEpisode => {
    if (!isRecord(episode) || episode.season_number !== expectedSeason ||
      !isIntegerInRange(episode.episode_number, 1, 9999) || seen.has(episode.episode_number)) {
      throw new Error("Episode metadata is unavailable or malformed. Please try again.");
    }
    seen.add(episode.episode_number);
    const rating = episode.vote_average;
    const still = optionalText(episode.still_path);
    return {
      id: positiveId(episode.id),
      episode_number: episode.episode_number,
      season_number: expectedSeason,
      name: optionalText(episode.name) || `Episode ${episode.episode_number}`,
      still_path: still.startsWith("/") && !still.startsWith("//") ? still : null,
      vote_average: typeof rating === "number" && Number.isFinite(rating) && rating >= 0 && rating <= 10
        ? rating : null,
      vote_count: isIntegerInRange(episode.vote_count, 0, Number.MAX_SAFE_INTEGER)
        ? episode.vote_count : null,
      air_date: getCalendarDate(episode.air_date),
      overview: optionalText(episode.overview),
      runtime: isIntegerInRange(episode.runtime, 1, Number.MAX_SAFE_INTEGER) ? episode.runtime : null,
    };
  }).sort((a, b) => a.episode_number - b.episode_number);

  return {
    id: positiveId(value.id),
    name: optionalText(value.name) || `Season ${expectedSeason}`,
    season_number: expectedSeason,
    episodes,
  };
};

// Numeric searches match the actual episode number, never its position or title.
export const filterEpisodes = (episodes: TMDBEpisode[], search: string): TMDBEpisode[] => {
  const query = search.trim();
  if (!query) return episodes;
  if (/^\d+$/.test(query)) {
    const number = Number(query);
    return episodes.filter((episode) => episode.episode_number === number);
  }
  const title = query.toLowerCase();
  return episodes.filter((episode) => episode.name.toLowerCase().includes(title));
};

// Neighbors come from actual metadata in the playing season, including sparse numbers.
// Return upcoming neighbors too: the controller disables them rather than skipping ahead.
export const getAdjacentEpisodes = (
  metadata: TMDBSeasonMetadata | undefined,
  season: number,
  episode: number,
): { previous: TMDBEpisode | undefined; next: TMDBEpisode | undefined } => {
  let previous: TMDBEpisode | undefined;
  let next: TMDBEpisode | undefined;
  if (!metadata || hasSelectedEpisode(metadata, season, episode) !== true) return { previous, next };
  for (const item of metadata.episodes) {
    if (item.season_number !== season) continue;
    if (item.episode_number < episode && (!previous || item.episode_number > previous.episode_number)) {
      previous = item;
    }
    if (item.episode_number > episode && (!next || item.episode_number < next.episode_number)) {
      next = item;
    }
  }
  return { previous, next };
};

// undefined means the matching season has not been successfully fetched, not "missing".
export const hasSelectedEpisode = (
  metadata: TMDBSeasonMetadata | undefined,
  season: number,
  episode: number,
): boolean | undefined => metadata?.season_number === season
  ? metadata.episodes.some((item) => item.episode_number === episode && item.season_number === season)
  : undefined;
