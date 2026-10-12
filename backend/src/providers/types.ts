export type MediaType = "movie" | "tv";

export interface Subtitle {
  lang: string;
  label: string;
  url: string;
}

/** A stream we serve through our own DASH relay + play in our own <video>. */
export interface DashSource {
  type: "dash";
  provider: string;
  label: string;
  manifestUrl: string;
  qualities?: number[];
  subtitles?: Subtitle[];
}

/** A third-party iframe embed that plays itself (no backend proxy needed). */
export interface EmbedSource {
  type: "embed";
  provider: string;
  label: string;
  embedUrl: string;
}

export type Source = DashSource | EmbedSource;

export interface ResolveParams {
  season?: number;
  episode?: number;
}
