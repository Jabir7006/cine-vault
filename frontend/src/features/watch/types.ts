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
