import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";
import { Tv } from "lucide-react";

import InfiniteMediaGrid, {
  InfiniteMediaGridSkeleton,
} from "@/components/common/InfiniteMediaGrid";
import MovieCard from "@/components/common/MovieCard";
import Section from "@/components/common/Section";
import SectionError from "@/components/common/SectionError";
import SectionHeader from "@/components/common/SectionHeader";
import { discoverTVShowsInfiniteOptions } from "../hooks/useTvShowsQueries";

const TvShowsGrid = () => (
  <InfiniteMediaGrid
    options={discoverTVShowsInfiniteOptions()}
    renderItem={(item, index, eager) => (
      <MovieCard item={item} index={index} eager={eager} mediaType="tv" />
    )}
    keyExtractor={(item) => item.id}
    emptyMessage="No TV shows available right now."
  />
);

const TvShowsComponent = () => (
  <Section
    id="tv-shows-heading"
    className="pt-28 sm:pt-32"
    glowClassName="-top-32 -right-32 bg-rose-600/15"
    glowClassName2="-bottom-32 -left-32 bg-orange-600/15"
  >
    <SectionHeader
      id="tv-shows-heading"
      className="mb-8 sm:mb-10"
      badgeLabel="TV Shows"
      badgeIcon={Tv}
      badgeIconClassName="text-rose-400"
      title="Discover TV shows"
      subtitle="Browse the latest and greatest series, updated regularly."
    />

    <CatchBoundary
      getResetKey={() => "discover-tv"}
      errorComponent={({ error, reset }) => (
        <SectionError
          error={error}
          reset={reset}
          queryKey={discoverTVShowsInfiniteOptions().queryKey}
          title="TV shows"
        />
      )}
    >
      <Suspense fallback={<InfiniteMediaGridSkeleton />}>
        <TvShowsGrid />
      </Suspense>
    </CatchBoundary>
  </Section>
);

export default TvShowsComponent;