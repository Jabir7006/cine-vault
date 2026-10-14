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
   * `adapted` marks the signed adaptive manifest rather than a progressive file. It is still one
   * descriptor and one URL, but a browser cannot read it: this quality plays through the player
   * lease's transcode, while a native player on this host opens the manifest as it is.
   */
  stream?: "adapted";
  /** The ladder an adapted manifest advertises, in its own order; a rung is chosen from it. */
  heights?: number[];
}

/**
 * The long-lived lease a title plays through.
 *
 * A capability lasts minutes and a film does not, so both the browser's transcode and a native
 * player are pointed at a lease instead: one stable URL whose authorization is replaced behind it.
 * Only programs on this host are served by it, which is why the origin is always loopback.
 */
export interface PlayerLease {
  base: string;
  origin: string;
  expiresAt: number;
  ladder: number[];
  /** Whether this host has the encoder the browser path needs. */
  encoder: boolean;
  /** The native player that would be launched, if one is installed. */
  native: string | null;
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

export type MovieBoxSetupReason = "missing_signing_key" | "invalid_signing_key" | "missing_tmdb_token" |
  "missing_media_hosts" | "invalid_relay_key" | "invalid_configuration";

export interface SourcesResponse {
  version: 2;
  sources: Source[];
  moviebox: {
    status: "ready" | "blocked_setup" | "not_found" | "ambiguous" | "unverified" |
      "unsupported_adaptive" | "unsupported_format" | "unavailable";
    reason?: MovieBoxSetupReason;
  };
}

export type PlaybackContinuity = { kind: "none" } | { kind: "same-resource"; qualityId: string };

export interface PreparedPlayback {
  version: 1;
  kind: "prepared";
  baseRevision: number;
  preparationId: string;
  preparationExpiresAt: number;
  source: DirectSource;
  continuity: PlaybackContinuity;
}

export interface PlaybackStateReply {
  version: 1;
  kind: "committed" | "state";
  source: DirectSource;
  pending?: PreparedPlayback | null;
}

export interface PlaybackErrorReply {
  version: 1;
  kind: "error";
  code: string;
}

export type PlaybackReply = PreparedPlayback | PlaybackStateReply | PlaybackErrorReply;
export interface PreparePlaybackRequest {
  version: 1;
  baseRevision: number;
  reason: "renew" | "audio";
  audioId?: string;
  qualityId?: string;
}
export interface CommitPlaybackRequest {
  version: 1;
  baseRevision: number;
  preparationId: string;
}

export interface TMDBEpisode {
  id: number | null;
  episode_number: number;
  season_number: number;
  name: string;
  still_path: string | null;
  vote_average: number | null;
  vote_count: number | null;
  air_date: string | null;
  overview: string;
  runtime: number | null;
}

export interface TMDBSeasonMetadata {
  id: number | null;
  name: string;
  season_number: number;
  episodes: TMDBEpisode[];
}
