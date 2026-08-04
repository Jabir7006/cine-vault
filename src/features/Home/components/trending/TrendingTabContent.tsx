import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";

import SectionError from "../../../../components/common/SectionError";
import { dailyTrendingOptions } from "../../hooks/useHomeQueries";
import TrendingItems from "./TrendingItems";
import MovieCardSkeleton from "@/components/common/MovieCardSkeleton";

interface TrendingTabContentProps {
  mediaType: "movie" | "tv";
}

const TrendingTabContent = ({ mediaType }: TrendingTabContentProps) => (
  <CatchBoundary
    getResetKey={() => `trending-${mediaType}`}
    errorComponent={({ error, reset }) => (
      <SectionError
        error={error}
        reset={reset}
        queryKey={dailyTrendingOptions(mediaType).queryKey}
        title={`trending ${mediaType === "movie" ? "movies" : "TV shows"}`}
      />
    )}
  >
    <Suspense
      fallback={
        <div className="grid grid-cols-5 gap-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <TrendingItems mediaType={mediaType} />
    </Suspense>
  </CatchBoundary>
);

export default TrendingTabContent;
