import { useSuspenseQuery } from "@tanstack/react-query";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import MovieCard from "@/components/common/MovieCard";
import { dailyTrendingOptions } from "../../hooks/useHomeQueries";

interface TrendingItemsProps {
  mediaType: "movie" | "tv";
}

const TrendingItems = ({ mediaType }: TrendingItemsProps) => {
  const { data: items } = useSuspenseQuery(dailyTrendingOptions(mediaType));

  return (
    <CarouselWrapper
      items={items ?? []}
      renderItem={(item, index) => <MovieCard item={item} index={index} />}
      keyExtractor={(item) => item.id}
      emptyMessage={`No trending ${mediaType === "movie" ? "movies" : "TV shows"} available right now.`}
    />
  );
};

export default TrendingItems;
