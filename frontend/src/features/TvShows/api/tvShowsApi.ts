import { getDiscoverMedia } from "@/features/discover/api";
import type { DiscoverTVParams } from "../types";

export const getDiscoverTVShows = (params: DiscoverTVParams = {}) =>
  getDiscoverMedia("tv", params);
