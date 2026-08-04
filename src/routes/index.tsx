import { createFileRoute } from "@tanstack/react-router";
import HomeComponent from "@/features/Home/Home";
import {
  streamingProvidersOptions,
  weeklyTrendingOptions,
} from "@/features/Home/hooks/useHomeQueries";

export const Route = createFileRoute("/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(weeklyTrendingOptions);

    void queryClient.prefetchQuery(streamingProvidersOptions);
  },
  component: HomeComponent,
});
