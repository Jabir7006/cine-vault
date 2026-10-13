import { getEmbedSources } from "./embed";
import { isMovieBoxSetupReason } from "../moviebox/runtime-status";
import type { DirectSource, MediaType, MovieBoxSetupReason, MovieBoxStatus, ResolveParams, SourcesResponse } from "./types";

export interface MovieBoxResolution {
  status: MovieBoxStatus;
  source?: DirectSource;
}

export type MovieBoxResolver = (
  type: MediaType,
  tmdbId: string,
  params: ResolveParams,
  signal?: AbortSignal,
) => Promise<MovieBoxResolution>;

/** A MovieBox miss must not prevent discovery of the unchanged embed candidates. */
export function createSourceService(resolveMovieBox?: MovieBoxResolver, setupReason?: MovieBoxSetupReason) {
  const reason = isMovieBoxSetupReason(setupReason) ? setupReason : undefined;
  return async (
    type: MediaType,
    tmdbId: string,
    params: ResolveParams = {},
    signal?: AbortSignal,
  ): Promise<SourcesResponse> => {
    let result: MovieBoxResolution = { status: "blocked_setup" };
    if (resolveMovieBox) {
      try {
        result = await resolveMovieBox(type, tmdbId, params, signal);
      } catch {
        result = { status: "unavailable" };
      }
    }
    if (result.status === "ready" && !result.source) result = { status: "unavailable" };
    return {
      version: 2,
      moviebox: {
        status: result.status,
        ...(result.status === "blocked_setup" && reason ? { reason } : {}),
      },
      sources: [
        ...(result.status === "ready" && result.source ? [result.source] : []),
        ...getEmbedSources(type, tmdbId, params),
      ],
    };
  };
}

export const getSources = createSourceService();
export type { Source } from "./types";
