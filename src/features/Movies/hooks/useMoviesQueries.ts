import { discoverMediaInfiniteOptions } from "@/features/discover/queries";
import type { DiscoverMovieParams } from "../types";

export const discoverMoviesInfiniteOptions = (
  params: DiscoverMovieParams = {},
) => discoverMediaInfiniteOptions("movie", params);
