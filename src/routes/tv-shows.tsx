import TvShowsComponent from "@/features/TvShows/components/TvShows";
import { discoverTVShowsInfiniteOptions } from "@/features/TvShows/hooks/useTvShowsQueries";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tv-shows")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchInfiniteQuery(discoverTVShowsInfiniteOptions());
  },
  component: TvShowsComponent,
});
