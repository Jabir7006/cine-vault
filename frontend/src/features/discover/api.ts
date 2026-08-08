import api from "@/lib/api";
import type { TMDBMediaItem, TMDBResponse } from "@/features/Home/types";

export type DiscoverMediaType = "movie" | "tv";

/**
 * Generic TMDB discover endpoint shared by Movies and TV Shows features.
 * Avoids duplicating API + query options logic across features.
 */
export const getDiscoverMedia = <TParams extends object>(
  mediaType: DiscoverMediaType,
  params: TParams,
) => {
  return api.get<TMDBResponse<TMDBMediaItem>>(`/discover/${mediaType}`, {
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
