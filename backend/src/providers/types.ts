export type MediaType = "movie" | "tv";

export interface Subtitle {
  id: string;
  lang: string;
  label: string;
  url: string;
}

export interface DirectQuality {
  id: string;
  label: string;
  url: string;
  height?: number;
  /**
   * `adapted` marks a signed adaptive manifest rather than a progressive file. It is still one
   * descriptor and one URL; only a player that can read a manifest may use it, which is why the
   * relay also offers a transcoded progressive stream for this quality.
   */
  stream?: "adapted";
  /** The ladder a manifest advertises, in its own order. */
  heights?: number[];
}

export interface DirectAudio {
  id: string;
  label: string;
  lang: string;
}

export interface DirectSource {
  type: "direct";
  provider: "moviebox";
  label: string;
  format: "progressive";
  sessionId: string;
  issuedAt: number;
  revision: number;
  controlToken: string;
  controlExpiresAt: number;
  expiresAt: number;
  renewAt: number;
  qualities: DirectQuality[];
  subtitles: Subtitle[];
  audios: DirectAudio[];
  selectedAudio: string;
}

export interface EmbedSource {
  type: "embed";
  provider: string;
  label: string;
  embedUrl: string;
}

export type Source = DirectSource | EmbedSource;

export type MovieBoxStatus = "ready" | "blocked_setup" | "not_found" | "ambiguous" |
  "unverified" | "unsupported_adaptive" | "unsupported_format" | "unavailable";

export type MovieBoxSetupReason = "missing_signing_key" | "invalid_signing_key" |
  "missing_tmdb_token" | "missing_media_hosts" | "invalid_relay_key" | "invalid_configuration";

export interface SourcesResponse {
  version: 2;
  sources: Source[];
  moviebox: { status: MovieBoxStatus; reason?: MovieBoxSetupReason };
}

export interface ResolveParams {
  season?: number;
  episode?: number;
}
