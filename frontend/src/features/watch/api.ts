import backendApi from "@/lib/backendApi";
import api from "@/lib/api";
import { parseSeasonMetadata } from "./episodes";
import type { MediaType } from "@/features/details/types";
import type { SourcesResponse } from "./types";

/**
 * Fetch source candidates from the backend; availability is not guaranteed.
 * MovieBox playback will be added after the client and relay are implemented.
 * `season`/`episode` are ignored by the backend for movies.
 */
export const getSources = (
  type: MediaType,
  tmdbId: string,
  opts?: { season?: number; episode?: number },
  signal?: AbortSignal,
) =>
  backendApi.get<SourcesResponse>(`/api/sources/${type}/${tmdbId}`, {
    params: { s: opts?.season, e: opts?.episode },
    signal,
  });

export const getSeasonMetadata = async (
  tmdbId: string,
  season: number,
  signal?: AbortSignal,
) => {
  const response = await api.get<unknown>(`/tv/${tmdbId}/season/${season}`, {
    params: { language: "en-US" },
    signal,
  });
  return parseSeasonMetadata(response.data, season);
};
