import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { Trophy } from "lucide-react";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import MovieCard from "@/components/common/MovieCard";
import MovieCardSkeleton from "@/components/common/MovieCardSkeleton";
import Section from "@/components/common/Section";
import SectionError from "@/components/common/SectionError";
import SectionHeader from "../../../../components/common/SectionHeader";
import { topRatedMoviesOptions } from "../../hooks/useHomeQueries";

const TopRatedMoviesCarousel = () => {
  const { data: movies } = useSuspenseQuery(topRatedMoviesOptions);

  return (
    <CarouselWrapper
      items={movies ?? []}
      renderItem={(item, index) => <MovieCard item={item} index={index} />}
      keyExtractor={(item) => item.id}
      emptyMessage="No top rated movies available right now."
    />
  );
};

const TopRatedMoviesSection = () => (
  <Section
    id="top-rated-movies-heading"
    glowClassName="-top-32 -right-32 bg-amber-500/15"
    glowClassName2="-bottom-32 -left-32 bg-emerald-600/15"
  >
    <SectionHeader
      id="top-rated-movies-heading"
      className="mb-8 sm:mb-10"
      badgeLabel="Top Rated"
      badgeIcon={Trophy}
      badgeIconClassName="text-amber-400"
      title="Critically acclaimed classics"
      subtitle="The highest-rated films of all time, handpicked by millions of viewers and critics alike."
    />

    <CatchBoundary
      getResetKey={() => "top-rated-movies"}
      errorComponent={({ error, reset }) => (
        <SectionError
          error={error}
          reset={reset}
          queryKey={topRatedMoviesOptions.queryKey}
          title="top rated movies"
        />
      )}
    >
      <Suspense
        fallback={
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <MovieCardSkeleton
                key={i}
                className="w-1/2 shrink-0 sm:w-1/3 md:w-1/4 lg:w-1/5 xl:w-1/6"
              />
            ))}
          </div>
        }
      >
        <TopRatedMoviesCarousel />
      </Suspense>
    </CatchBoundary>
  </Section>
);

export default TopRatedMoviesSection;