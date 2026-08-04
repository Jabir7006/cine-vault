import { queryOptions } from "@tanstack/react-query";
import { getStreamingProviderList, getWeeklyTrending } from "../api/homeApi";

export const weeklyTrendingOptions = queryOptions({
  queryKey: ["weekly-trending"],
  queryFn: () =>
    getWeeklyTrending().then((res) => res.data?.results.slice(0, 7)),
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
});

export const streamingProvidersOptions = queryOptions({
  queryKey: ["streaming-providers"],
  queryFn: () => getStreamingProviderList(),
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
});
