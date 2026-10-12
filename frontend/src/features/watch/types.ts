export interface Subtitle {
  lang: string;
  label: string;
  url: string;
}

export interface DashSource {
  type: "dash";
  provider: string;
  label: string;
  manifestUrl: string;
  qualities?: number[];
  subtitles?: Subtitle[];
}

export interface EmbedSource {
  type: "embed";
  provider: string;
  label: string;
  embedUrl: string;
}

export type Source = DashSource | EmbedSource;

export interface SourcesResponse {
  sources: Source[];
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
