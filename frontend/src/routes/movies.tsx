import { createFileRoute } from "@tanstack/react-router";
import MoviesComponent from "@/features/Movies/components/MoviesPage";
import { discoverMoviesInfiniteOptions } from "@/features/Movies/hooks/useMoviesQueries";

export const Route = createFileRoute("/movies")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchInfiniteQuery(discoverMoviesInfiniteOptions());
  },
  component: MoviesComponent,
});
