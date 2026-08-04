import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";

import SectionError from "../../../../components/common/SectionError";
import { dailyTrendingOptions } from "../../hooks/useHomeQueries";
import TrendingItems from "./TrendingItems";
import TrendingSkeleton from "./TrendingSkeleton";

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
    <Suspense fallback={<TrendingSkeleton />}>
      <TrendingItems mediaType={mediaType} />
    </Suspense>
  </CatchBoundary>
);

export default TrendingTabContent;
