import type { Source } from "./types";

export const resolveSource = (sources: Source[], preferredProvider?: string): Source | undefined =>
  sources.find((source) => source.provider === preferredProvider) ?? sources[0];

export const playbackIdentity = (
  mediaType: string,
  mediaId: string,
  season: number,
  episode: number,
): string => mediaType === "tv"
  ? `${mediaType}:${mediaId}:${season}:${episode}`
  : `${mediaType}:${mediaId}`;
