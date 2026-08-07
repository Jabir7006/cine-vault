import api from "@/lib/api";
import type { TMDBMediaItem, TMDBResponse } from "@/features/Home/types";
import type { SearchFilter } from "./types";

/**
 * Searches TMDB for movies and/or TV shows.
 * - "all" uses the multi-search endpoint (returns both, with media_type set)
 * - "movie" uses the movie search endpoint
 * - "tv" uses the TV search endpoint
 */
export const searchMedia = (
  query: string,
  filter: SearchFilter,
  page: number = 1,
) => {
  const endpoint =
    filter === "all" ? "/search/multi" : `/search/${filter}`;

  return api.get<TMDBResponse<TMDBMediaItem>>(endpoint, {
    params: {
      query,
      language: "en-US",
      page,
      include_adult: false,
    },
  });
};