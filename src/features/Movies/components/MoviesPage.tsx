import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";

import InfiniteMediaGrid, {
  InfiniteMediaGridSkeleton,
} from "@/components/common/InfiniteMediaGrid";
import MovieCard from "@/components/common/MovieCard";
import Section from "@/components/common/Section";
import SectionError from "@/components/common/SectionError";
import SectionHeader from "@/components/common/SectionHeader";
import { discoverMoviesInfiniteOptions } from "../hooks/useMoviesQueries";

const MoviesGrid = () => (
  <InfiniteMediaGrid
    options={discoverMoviesInfiniteOptions()}
    renderItem={(item, index, eager) => (
      <MovieCard item={item} index={index} eager={eager} />
    )}
    keyExtractor={(item) => item.id}
    emptyMessage="No movies available right now."
  />
);

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
          queryKey={discoverMoviesInfiniteOptions().queryKey}
          title="movies"
        />
      )}
    >
      <Suspense fallback={<InfiniteMediaGridSkeleton />}>
        <MoviesGrid />
      </Suspense>
    </CatchBoundary>
  </Section>
);

export default MoviesComponent;
