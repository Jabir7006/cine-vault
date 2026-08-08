// ========== Sort Options ==========
export type TVSortBy =
  | "popularity.desc"
  | "popularity.asc"
  | "vote_average.desc"
  | "vote_average.asc"
  | "first_air_date.desc"
  | "first_air_date.asc";

// ========== API Query Params ==========
export interface DiscoverTVParams {
  language?: string;
  page?: number;
  sort_by?: TVSortBy;
  with_genres?: string;
  first_air_date_year?: number;
  "first_air_date.gte"?: string;
  "first_air_date.lte"?: string;
  "vote_average.gte"?: number;
  "vote_average.lte"?: number;
  "vote_count.gte"?: number;
  with_original_language?: string;
  include_adult?: boolean;
  include_video?: boolean;
  with_runtime_min?: number;
  with_runtime_max?: number;
}
