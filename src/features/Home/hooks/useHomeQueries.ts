import { queryOptions } from "@tanstack/react-query";
import { getStreamingProviderList, getWeeklyTrending } from "../api/homeApi";

export const weeklyTrendingOptions = queryOptions({
  queryKey: ["weekly-trending"],
  queryFn: () =>
    getWeeklyTrending().then((res) => res.data?.results.slice(0, 7)),
});

export const streamingProvidersOptions = queryOptions({
  queryKey: ["streaming-providers"],
  queryFn: () => getStreamingProviderList(),
});
