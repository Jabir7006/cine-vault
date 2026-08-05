import { infiniteQueryOptions } from "@tanstack/react-query";
import { getDiscoverMovies } from "../api/moviesApi";
import type { DiscoverMovieParams } from "../types";

export const discoverMoviesInfiniteOptions = (
  params: DiscoverMovieParams = {},
) =>
  infiniteQueryOptions({
    queryKey: ["discover-movies", params],
    queryFn: ({ pageParam }) =>
      getDiscoverMovies({ ...params, page: pageParam }).then((res) => res.data),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
