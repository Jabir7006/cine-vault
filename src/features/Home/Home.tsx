import { Suspense } from "react";
import { CatchBoundary } from "@tanstack/react-router";

import HeroCarousel from "./components/hero/HeroCarousel";
import HeroSkeleton from "./components/hero/HeroSkeleton";
import ProvidersError from "./components/providers/ProvidersError";
import ProvidersSection from "./components/providers/ProvidersSection";
import ProvidersSkeleton from "./components/providers/ProvidersSkeleton";

const HomeComponent = () => {
  return (
    <>
      <Suspense fallback={<HeroSkeleton />}>
        <HeroCarousel />
      </Suspense>

      <CatchBoundary
        getResetKey={() => "streaming-providers"}
        errorComponent={ProvidersError}
      >
        <Suspense fallback={<ProvidersSkeleton />}>
          <ProvidersSection />
        </Suspense>
      </CatchBoundary>
    </>
  );
};

export default HomeComponent;