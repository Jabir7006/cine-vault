// ========== Sort Options ==========
export type MovieSortBy =
  | "popularity.desc"
  | "popularity.asc"
  | "vote_average.desc"
  | "vote_average.asc"
  | "primary_release_date.desc"
  | "primary_release_date.asc"
  | "revenue.desc"
  | "title.asc"
  | "title.desc";

// ========== Filter State For UI ==========
export interface MovieFilters {
  genres?: number[];
  sortBy?: MovieSortBy;
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  voteAverageGte?: number;
  voteAverageLte?: number;
  runtimeGte?: number;
  runtimeLte?: number;
  originalLanguage?: string;
  includeAdult?: boolean;
  page?: number;
}

// ========== API Query Params ==========
export interface DiscoverMovieParams {
  language?: string;
  page?: number;
  sort_by?: MovieSortBy;
  with_genres?: string;
  primary_release_year?: number;
  "primary_release_date.gte"?: string;
  "primary_release_date.lte"?: string;
  "vote_average.gte"?: number;
  "vote_average.lte"?: number;
  "vote_count.gte"?: number;
  "with_runtime.gte"?: number;
  "with_runtime.lte"?: number;
  with_original_language?: string;
  include_adult?: boolean;
  include_video?: boolean;
  region?: string;
}
