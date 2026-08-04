import { createFileRoute } from "@tanstack/react-router";
import HomeComponent from "@/features/Home/Home";
import {
  dailyTrendingOptions,
  streamingProvidersOptions,
  weeklyTrendingOptions,
} from "@/features/Home/hooks/useHomeQueries";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(weeklyTrendingOptions);

    void queryClient.prefetchQuery(streamingProvidersOptions);
    void queryClient.prefetchQuery(dailyTrendingOptions("movie"));
  },
  component: HomeComponent,
});
