import { infiniteQueryOptions } from "@tanstack/react-query";
import { getDiscoverMedia, type DiscoverMediaType } from "./api";

/**
 * Creates infinite query options for a TMDB discover endpoint.
 * Shared by Movies and TV Shows features
 */
export const discoverMediaInfiniteOptions = <TParams extends object>(
  mediaType: DiscoverMediaType,
  params: TParams,
) =>
  infiniteQueryOptions({
    queryKey: [`discover-${mediaType}`, params],
    queryFn: ({ pageParam }) =>
      getDiscoverMedia(mediaType, { ...params, page: pageParam }).then(
        (res) => res.data,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
