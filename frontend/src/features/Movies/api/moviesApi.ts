import { getDiscoverMedia } from "@/features/discover/api";
import type { DiscoverMovieParams } from "../types";

export const getDiscoverMovies = (params: DiscoverMovieParams = {}) =>
  getDiscoverMedia("movie", params);
