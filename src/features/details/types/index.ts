export type MediaType = "movie" | "tv";

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
  known_for_department?: string;
}

export interface CreditsPart {
  id: number;
  cast: CastMember[];
}

export interface VideoPart {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
  published_at: string;
}

export interface ProviderPart {
  id: number;
  results: Record<
    string,
    {
      link?: string;
      flatrate?: { provider_id: number; provider_name: string; logo_path: string | null }[];
      rent?: { provider_id: number; provider_name: string; logo_path: string | null }[];
      buy?: { provider_id: number; provider_name: string; logo_path: string | null }[];
    }
  >;
}

export interface SimilarMediaPart {
  page: number;
  results: Array<{
    id: number;
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    overview: string;
    backdrop_path: string | null;
    poster_path: string | null;
    media_type?: "movie" | "tv" | string;
    genre_ids: number[];
    popularity: number;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    vote_count: number;
    adult: boolean;
  }>;
  total_pages: number;
  total_results: number;
}

export interface TMDBMediaDetails {
  id: number;
  // Movie-specific
  title?: string;
  original_title?: string;
  release_date?: string;
  runtime?: number;
  // TV-specific
  name?: string;
  original_name?: string;
  first_air_date?: string;
  last_air_date?: string;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  // Shared
  overview: string;
  tagline?: string;
  backdrop_path: string | null;
  poster_path: string | null;
  genre_ids?: number[];
  genres?: TMDBGenre[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  status?: string;
  homepage?: string;
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  // append_to_response sections
  credits?: CreditsPart;
  videos?: { results: VideoPart[] };
  similar?: SimilarMediaPart;
  "watch/providers"?: ProviderPart;
}

export const getMediaTitle = (details: TMDBMediaDetails): string =>
  details.title ||
  details.name ||
  details.original_title ||
  details.original_name ||
  "Untitled";

export const getMediaReleaseDate = (details: TMDBMediaDetails): string =>
  details.release_date || details.first_air_date || "";

export const getMediaYear = (details: TMDBMediaDetails): number | undefined => {
  const date = getMediaReleaseDate(details);
  return date ? new Date(date).getFullYear() : undefined;
};

export const getMediaRuntime = (details: TMDBMediaDetails): number | undefined =>
  details.runtime ?? details.episode_run_time?.[0];

export const getMediaPosterUrl = (
  posterPath: string | null,
  size: "w185" | "w342" | "w500" | "w780" = "w500",
): string =>
  posterPath ? `https://image.tmdb.org/t/p/${size}${posterPath}` : "";

export const getMediaBackdropUrl = (
  backdropPath: string | null,
  size: "w780" | "w1280" | "original" = "w1280",
): string =>
  backdropPath
    ? `https://image.tmdb.org/t/p/${size}${backdropPath}`
    : "";