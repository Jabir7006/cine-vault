import { getEmbedSources } from "./embed";
import type { MediaType, ResolveParams, Source } from "./types";

/**
 * List source candidates for a title, ordered by preference.
 * MovieBox integration is planned but not implemented. Embed URLs are generated
 * without checking provider availability or whether the requested title plays.
 */
export async function getSources(
  type: MediaType,
  tmdbId: string,
  params: ResolveParams = {},
): Promise<Source[]> {
  const sources: Source[] = [];

  // TODO(phase 2-3): prepend MovieBox dash sources (primary) here.

  sources.push(...getEmbedSources(type, tmdbId, params));

  return sources;
}

export type { Source } from "./types";
