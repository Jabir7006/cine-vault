import { createFileRoute } from "@tanstack/react-router";
import HomeComponent from "@/features/Home/Home";
import { streamingProvidersOptions } from "@/features/Home/hooks/useHomeQueries";

export const Route = createFileRoute("/")({
  loader: ({ context }) => {
    void context.queryClient
      .prefetchQuery(streamingProvidersOptions)
      .catch(() => undefined);
  },
  component: HomeComponent,
});
