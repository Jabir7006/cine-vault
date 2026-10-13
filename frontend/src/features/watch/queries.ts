import { queryOptions } from "@tanstack/react-query";
import type { MediaType } from "@/features/details/types";
import { getSeasonMetadata, getSources } from "./api";
import { playbackDiscoveryKey } from "./playback";

export const watchSourcesOptions = (
  type: MediaType,
  tmdbId: string,
  season = 1,
  episode = 1,
  discoveryOwner = "standalone",
) =>
  queryOptions({
    queryKey: playbackDiscoveryKey(discoveryOwner, type, tmdbId, season, episode),
    queryFn: ({ signal }) =>
      getSources(type, tmdbId, type === "tv" ? { season, episode } : undefined, signal).then((r) => r.data),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

export const seasonMetadataOptions = (tmdbId: string, season: number) =>
  queryOptions({
    queryKey: ["watch-episodes", tmdbId, season],
    queryFn: ({ signal }) => getSeasonMetadata(tmdbId, season, signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
