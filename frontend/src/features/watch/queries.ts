import { queryOptions } from "@tanstack/react-query";
import type { MediaType } from "@/features/details/types";
import { getSeasonMetadata, getSources } from "./api";

export const watchSourcesOptions = (
  type: MediaType,
  tmdbId: string,
  season = 1,
  episode = 1,
) =>
  queryOptions({
    queryKey: ["watch-sources", type, tmdbId, type === "tv" ? season : 1, type === "tv" ? episode : 1],
    queryFn: ({ signal }) =>
      getSources(type, tmdbId, type === "tv" ? { season, episode } : undefined, signal).then((r) => r.data),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

export const seasonMetadataOptions = (tmdbId: string, season: number) =>
  queryOptions({
    queryKey: ["watch-episodes", tmdbId, season],
    queryFn: ({ signal }) => getSeasonMetadata(tmdbId, season, signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
