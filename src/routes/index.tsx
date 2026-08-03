import { createFileRoute } from "@tanstack/react-router";
import HomeComponent from "@/features/Home/Home";
import { weeklyTrendingOptions } from "@/features/Home/hooks/useHomeQueries";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => {
    const carouselData = queryClient.ensureQueryData(weeklyTrendingOptions);

    return carouselData;
  },
  component: HomeComponent,
});
