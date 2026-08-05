import { queryOptions } from "@tanstack/react-query";
import { getDiscoverMovies } from "../api/moviesApi";
import type { DiscoverMovieParams } from "../types";

export const discoverMoviesOptions = (params: DiscoverMovieParams = {}) =>
  queryOptions({
    queryKey: ["discover-movies", params],
    queryFn: () => getDiscoverMovies(params).then((res) => res.data),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
