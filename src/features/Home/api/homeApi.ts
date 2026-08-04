import api from "@/lib/api";
import type { StreamingProvider, TMDBMediaItem, TMDBResponse } from "../types";

interface WatchProviderResult {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
  display_priorities?: Record<string, number>;
}

const mapWatchProvider = (
  provider: WatchProviderResult,
  index: number,
): StreamingProvider => ({
  id: provider.provider_id,
  name: provider.provider_name,
  logoUrl: provider.logo_path
    ? `https://image.tmdb.org/t/p/w185${provider.logo_path}`
    : "",
  priority:
    provider.display_priorities?.US ??
    provider.display_priority ??
    index,
});

export const getWeeklyTrending = () => {
  return api.get<TMDBResponse<TMDBMediaItem>>(
    "/trending/all/week?language=en-US",
  );
};

export const getStreamingProviderList = async (): Promise<StreamingProvider[]> => {
  const { data } = await api.get<{ results: WatchProviderResult[] }>(
    "/watch/providers/movie?language=en-US&watch_region=US",
  );

  return data.results
    .filter((provider) => provider.display_priorities?.US != null)
    .map(mapWatchProvider)
    .filter((provider) => provider.logoUrl)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 24);
};
