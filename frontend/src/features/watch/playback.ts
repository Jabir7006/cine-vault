import type { DirectSource, Source } from "./types";

/** Candidate discovery never takes ownership away from committed playback. */
export const resolveOwnedSource = (sources: Source[], preferredProvider?: string, committed?: DirectSource): Source | undefined =>
  committed ?? resolveSource(sources, preferredProvider);

export const resolveSource = (sources: Source[], preferredProvider?: string): Source | undefined =>
  sources.find((source) => source.provider === preferredProvider) ?? sources[0];

export const playbackDiscoveryKey = (owner: string, type: string, mediaId: string, season: number, episode: number) =>
  ["watch-sources", owner, type, mediaId, type === "tv" ? season : 1, type === "tv" ? episode : 1] as const;

export const playbackIdentity = (
  mediaType: string,
  mediaId: string,
  season: number,
  episode: number,
): string => mediaType === "tv"
  ? `${mediaType}:${mediaId}:${season}:${episode}`
  : `${mediaType}:${mediaId}`;
