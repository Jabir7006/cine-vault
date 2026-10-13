import backendApi from "@/lib/backendApi";
import api from "@/lib/api";
import { parseSeasonMetadata } from "./episodes";
import type { MediaType } from "@/features/details/types";
import type { CommitPlaybackRequest, DirectSource, PlaybackReply, PreparePlaybackRequest, SourcesResponse } from "./types";
import { parsePlaybackReply } from "./session-response";
import { parseSourcesResponse } from "./source-response";
import { discoveryFailure, SourcesDiscoveryError, SOURCES_TIMEOUT_MS } from "./discovery-error";

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
    timeout: SOURCES_TIMEOUT_MS,
  }).then((response) => {
    // Strict v2 validation remains all-or-nothing, especially for direct capabilities.
    try {
      const data = parseSourcesResponse(response.data);
      const sources: SourcesResponse["sources"] = data.sources.map((source) => source.type === "embed" ? source : normalizeDirect(source));
      return { ...response, data: { ...data, sources } };
    } catch {
      throw new SourcesDiscoveryError("malformed");
    }
  }).catch((error: unknown) => { throw discoveryFailure(error); });

const normalizeDirect = (source: DirectSource): DirectSource => {
  const origin = new URL(backendApi.defaults.baseURL ?? "/", window.location.origin).origin;
  return {
    ...source,
    qualities: source.qualities.map((quality) => ({ ...quality, url: new URL(quality.url, origin).href })),
    subtitles: source.subtitles.map((subtitle) => ({ ...subtitle, url: new URL(subtitle.url, origin).href })),
  };
};
const normalizeReply = (reply: PlaybackReply): PlaybackReply => {
  if (reply.kind === "error") return reply;
  if (reply.kind === "prepared") return { ...reply, source: normalizeDirect(reply.source) };
  return {
    ...reply, source: normalizeDirect(reply.source),
    ...(reply.pending ? { pending: { ...reply.pending, source: normalizeDirect(reply.pending.source) } } : {}),
  };
};

// Control capabilities are memory-only headers on fixed backend paths. The
// existing backendApi interceptor still supplies the optional deployment guard.
const playbackOperation = async (
  source: DirectSource, action: "state" | "prepare" | "commit", signal: AbortSignal,
  body?: PreparePlaybackRequest | CommitPlaybackRequest,
): Promise<PlaybackReply> => {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}$/.test(source.sessionId)) throw new Error("Invalid playback session.");
  const path = `/api/playback/${encodeURIComponent(source.sessionId)}${action === "state" ? "" : `/${action}`}`;
  const config = { signal, timeout: 15_000, headers: { "x-playback-control": source.controlToken } };
  const response = action === "state"
    ? await backendApi.get<unknown>(path, config)
    : await backendApi.post<unknown>(path, body, config);
  return normalizeReply(parsePlaybackReply(response.data, source));
};
export const getPlaybackState = (source: DirectSource, signal: AbortSignal) => playbackOperation(source, "state", signal);
export const preparePlayback = (source: DirectSource, body: PreparePlaybackRequest, signal: AbortSignal) => playbackOperation(source, "prepare", signal, body);
export const commitPlayback = (source: DirectSource, body: CommitPlaybackRequest, signal: AbortSignal) => playbackOperation(source, "commit", signal, body);

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
