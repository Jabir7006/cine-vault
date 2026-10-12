import type { EmbedSource, MediaType, ResolveParams } from "./types";

interface EmbedProvider {
  id: string;
  label: string;
  movie: (tmdbId: string) => string;
  tv: (tmdbId: string, season: number, episode: number) => string;
}

/**
 * Third-party iframe embed providers, keyed by TMDB id. They host their own
 * player + sources. Generated URLs do not guarantee availability or playback;
 * DNS, framing policies, sandbox restrictions, and codec support can prevent it.
 * Order = default preference.
 */
const PROVIDERS: EmbedProvider[] = [
  {
    id: "embedwave.cc",
    label: "EmbedWave",
    movie: (id) => `https://embedwave.cc/embed/movie/${id}`,
    tv: (id, s, e) => `https://embedwave.cc/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidcore.org",
    label: "Vidcore",
    movie: (id) => `https://vidcore.org/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidcore.org/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrc.to",
    label: "VidSrc",
    movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidlink",
    label: "VidLink",
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
  {
    id: "2embed",
    label: "2Embed",
    movie: (id) => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
  },
];

export function getEmbedSources(
  type: MediaType,
  tmdbId: string,
  { season = 1, episode = 1 }: ResolveParams = {},
): EmbedSource[] {
  return PROVIDERS.map((p) => ({
    type: "embed" as const,
    provider: p.id,
    label: p.label,
    embedUrl:
      type === "movie" ? p.movie(tmdbId) : p.tv(tmdbId, season, episode),
  }));
}
