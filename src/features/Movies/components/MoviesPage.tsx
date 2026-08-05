import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";

import MovieCard from "@/components/common/MovieCard";
import MovieCardSkeleton from "@/components/common/MovieCardSkeleton";
import Section from "@/components/common/Section";
import SectionError from "@/components/common/SectionError";
import SectionHeader from "@/components/common/SectionHeader";
import { discoverMoviesOptions } from "../hooks/useMoviesQueries";

const MoviesGrid = () => {
  const { data } = useSuspenseQuery(discoverMoviesOptions());

  const movies = data?.results ?? [];

  if (movies.length === 0) {
    return (
      <p className="text-sm text-neutral-500">No movies available right now.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {movies.map((movie, index) => (
        <MovieCard key={movie.id} item={movie} index={index} />
      ))}
    </div>
  );
};

const MoviesComponent = () => (
  <Section
    id="movies-heading"
    className="pt-28 sm:pt-32"
    glowClassName="-top-32 -right-32 bg-indigo-600/15"
    glowClassName2="-bottom-32 -left-32 bg-cyan-600/15"
  >
    <SectionHeader
      id="movies-heading"
      className="mb-8 sm:mb-10"
      badgeLabel="Movies"
      badgeIcon={Clapperboard}
      badgeIconClassName="text-indigo-400"
      title="Discover movies"
      subtitle="Browse the latest and greatest films, updated regularly."
    />

    <CatchBoundary
      getResetKey={() => "discover-movies"}
      errorComponent={({ error, reset }) => (
        <SectionError
          error={error}
          reset={reset}
          queryKey={discoverMoviesOptions().queryKey}
          title="movies"
        />
      )}
    >
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 18 }).map((_, i) => (
              <MovieCardSkeleton key={i} />
            ))}
          </div>
        }
      >
        <MoviesGrid />
      </Suspense>
    </CatchBoundary>
  </Section>
);

export default MoviesComponent;
