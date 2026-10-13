import backendApi from "@/lib/backendApi";
import api from "@/lib/api";
import { parseSeasonMetadata } from "./episodes";
import type { MediaType } from "@/features/details/types";
import type { SourcesResponse } from "./types";
import { parseSourcesResponse } from "./source-response";

/**
 * Fetch source candidates from the backend; availability is not guaranteed.
 * Direct capabilities are validated before resolving them against the backend origin.
 * `season`/`episode` are ignored by the backend for movies.
 */
export const getSources = (
  type: MediaType,
  tmdbId: string,
  opts?: { season?: number; episode?: number },
  signal?: AbortSignal,
) =>
  backendApi.get<unknown>(`/api/sources/${type}/${tmdbId}`, {
    params: { s: opts?.season, e: opts?.episode },
    signal,
  }).then((response) => {
    const data = parseSourcesResponse(response.data);
    const origin = new URL(backendApi.defaults.baseURL ?? "/", window.location.origin).origin;
    const sources: SourcesResponse["sources"] = data.sources.map((source) => source.type === "embed" ? source : {
      ...source,
      qualities: source.qualities.map((quality) => ({ ...quality, url: new URL(quality.url, origin).href })),
      subtitles: source.subtitles.map((subtitle) => ({ ...subtitle, url: new URL(subtitle.url, origin).href })),
    });
    return { ...response, data: { ...data, sources } };
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
