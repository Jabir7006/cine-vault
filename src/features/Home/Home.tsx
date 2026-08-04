import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";

import HeroCarousel from "./components/hero/HeroCarousel";
import SectionError from "../../components/common/SectionError";
import ProvidersSection from "./components/providers/ProvidersSection";
import ProvidersSkeleton from "./components/providers/ProvidersSkeleton";
import TrendingSection from "./components/trending/TrendingSection";
import {
  streamingProvidersOptions,
  weeklyTrendingOptions,
} from "./hooks/useHomeQueries";
import HeroSkeleton from "./components/hero/HeroSkeleton";

const HomeComponent = () => {
  return (
    <>
      <CatchBoundary
        getResetKey={() => "weekly-trending"}
        errorComponent={({ error, reset }) => (
          <SectionError
            error={error}
            reset={reset}
            queryKey={weeklyTrendingOptions.queryKey}
            title="hero carousel"
          />
        )}
      >
        <Suspense fallback={<HeroSkeleton />}>
          <HeroCarousel />
        </Suspense>
      </CatchBoundary>
      <CatchBoundary
        getResetKey={() => "streaming-providers"}
        errorComponent={({ error, reset }) => (
          <SectionError
            error={error}
            reset={reset}
            queryKey={streamingProvidersOptions.queryKey}
            title="streaming providers"
          />
        )}
      >
        <Suspense fallback={<ProvidersSkeleton />}>
          <ProvidersSection />
        </Suspense>
      </CatchBoundary>

      <TrendingSection />
    </>
  );
};

export default HomeComponent;
