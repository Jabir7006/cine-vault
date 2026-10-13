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

export interface SourcesResponse {
  version: 1;
  sources: Source[];
  moviebox: {
    status: "ready" | "blocked_setup" | "not_found" | "ambiguous" | "unverified" |
      "unsupported_adaptive" | "unsupported_format" | "unavailable";
  };
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
