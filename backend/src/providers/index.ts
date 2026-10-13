import { getEmbedSources } from "./embed";
import type { DirectSource, MediaType, MovieBoxStatus, ResolveParams, SourcesResponse } from "./types";

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
export function createSourceService(resolveMovieBox?: MovieBoxResolver) {
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
      version: 1,
      moviebox: { status: result.status },
      sources: [
        ...(result.status === "ready" && result.source ? [result.source] : []),
        ...getEmbedSources(type, tmdbId, params),
      ],
    };
  };
}

export const getSources = createSourceService();
export type { Source } from "./types";
