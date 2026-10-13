import type { EmbedSource, Source } from "./types";

/** Offline candidates only, never evidence of provider playback or MovieBox readiness.
 * Keep the URLs/order equal to backend providers/embed.ts (covered by contract tests).
 * No backend imports: runtime/signing code must never enter the browser bundle.
 */
export function getFallbackEmbedSources(
  type: string, tmdbId: string, season = 1, episode = 1,
): EmbedSource[] {
  if ((type !== "movie" && type !== "tv") || typeof tmdbId !== "string" ||
      !/^\d{1,20}$/.test(tmdbId) || !/[1-9]/.test(tmdbId) ||
      !Number.isSafeInteger(season) || season < 1 || season > 99 ||
      !Number.isSafeInteger(episode) || episode < 1 || episode > 9999) return [];
  const path = `${type}/${tmdbId}${type === "tv" ? `/${season}/${episode}` : ""}`;
  return [
    { type: "embed", provider: "embedwave.cc", label: "EmbedWave", embedUrl: `https://embedwave.cc/embed/${path}` },
    { type: "embed", provider: "vidcore.org", label: "Vidcore", embedUrl: `https://vidcore.org/embed/${path}` },
    { type: "embed", provider: "vidsrc.to", label: "VidSrc", embedUrl: `https://vidsrc.to/embed/${path}` },
    { type: "embed", provider: "vidlink", label: "VidLink", embedUrl: `https://vidlink.pro/${path}` },
    { type: "embed", provider: "2embed", label: "2Embed", embedUrl: type === "movie"
      ? `https://www.2embed.cc/embed/${tmdbId}`
      : `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}` },
  ];
}

/** Wait for initial MovieBox discovery; only a failed request activates local embeds.
 * Keep any validated cached sources, including direct sessions, on a refetch error.
 */
export function sourcesWithEmbedFallback(
  sources: Source[] | undefined, isError: boolean,
  type: string, tmdbId: string, season = 1, episode = 1,
): Source[] {
  const existing = sources ?? [];
  if (!isError) return existing;
  return [...existing, ...getFallbackEmbedSources(type, tmdbId, season, episode)
    .filter((fallback) => !existing.some((source) => source.provider === fallback.provider))];
}
