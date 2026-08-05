import api from "@/lib/api";
import type { TMDBMediaItem, TMDBResponse } from "@/features/Home/types";
import type { DiscoverMovieParams } from "../types";

export const getDiscoverMovies = (params: DiscoverMovieParams = {}) => {
  return api.get<TMDBResponse<TMDBMediaItem>>("/discover/movie", {
    params: {
      language: "en-US",
      page: 1,
      sort_by: "popularity.desc",
      include_adult: false,
      include_video: false,
      ...params,
    },
  });
};
