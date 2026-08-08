import { discoverMediaInfiniteOptions } from "@/features/discover/queries";
import type { DiscoverTVParams } from "../types";

export const discoverTVShowsInfiniteOptions = (params: DiscoverTVParams = {}) =>
  discoverMediaInfiniteOptions("tv", params);
