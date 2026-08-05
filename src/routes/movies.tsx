import { createFileRoute } from "@tanstack/react-router";
import MoviesComponent from "@/features/Movies/components/MoviesPage";
import { discoverMoviesOptions } from "@/features/Movies/hooks/useMoviesQueries";

export const Route = createFileRoute("/movies")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(discoverMoviesOptions());
  },
  component: MoviesComponent,
});
