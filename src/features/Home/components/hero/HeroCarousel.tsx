import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence } from "framer-motion";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";

import HeroBackdrop from "./HeroBackdrop";
import HeroContent from "./HeroContent";
import HeroControls from "./HeroControls";
import HeroIndicators from "./HeroIndicators";
import HeroSkeleton from "./HeroSkeleton";
import SectionError from "@/components/common/SectionError";
import { useHeroAutoplay } from "@/features/Home/hooks/useHeroAutoplay";
import { weeklyTrendingOptions } from "../../hooks/useHomeQueries";
import {
  mapTMDBToHeroMovie,
  type HeroMovie,
  type TMDBMediaItem,
} from "../../types";

const SWIPE_THRESHOLD = 48;

const HeroCarouselContent = () => {
  const { data: rawTrending } = useSuspenseQuery(weeklyTrendingOptions);

  const movies: HeroMovie[] = useMemo(() => {
    if (!rawTrending || !Array.isArray(rawTrending)) return [];
    return (rawTrending as TMDBMediaItem[]).map(mapTMDBToHeroMovie);
  }, [rawTrending]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = movies.length;
  const activeMovie = movies[activeIndex] ?? movies[0];

  const goTo = useCallback(
    (index: number) => {
      if (count > 0) setActiveIndex((index + count) % count);
    },
    [count],
  );
  const goNext = useCallback(() => {
    if (count > 0) setActiveIndex((current) => (current + 1) % count);
  }, [count]);
  const goPrev = useCallback(() => {
    if (count > 0) setActiveIndex((current) => (current - 1 + count) % count);
  }, [count]);

  const progress = useHeroAutoplay({
    index: activeIndex,
    count,
    paused,
    onAdvance: goNext,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrev();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current === null) return;

    const deltaX = event.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) >= SWIPE_THRESHOLD) (deltaX < 0 ? goNext : goPrev)();

    touchStartX.current = null;
  };

  if (!activeMovie || count === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0"
      onMouseDownCapture={() => setPaused(true)}
      onMouseUpCapture={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Backdrop */}
      <AnimatePresence initial={false}>
        <HeroBackdrop
          key={activeMovie.id}
          movie={activeMovie}
          isFirst={activeIndex === 0}
        />
      </AnimatePresence>

      {/* Content */}
      <div className="absolute inset-0 z-10 flex flex-col justify-end">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 pb-24 pt-24 sm:px-8 sm:pb-20 lg:px-12">
          <AnimatePresence mode="wait">
            <HeroContent key={activeMovie.id} movie={activeMovie} />
          </AnimatePresence>

          <div className="flex items-end justify-between gap-4">
            <HeroIndicators
              movies={movies}
              activeIndex={activeIndex}
              progress={progress}
              onSelect={goTo}
            />
            <HeroControls onPrev={goPrev} onNext={goNext} />
          </div>
        </div>
      </div>
    </div>
  );
};

const HeroCarousel = () => (
  <section
    aria-label="Featured movies"
    aria-roledescription="carousel"
    className="relative h-svh w-full overflow-hidden bg-neutral-950 text-white"
  >
    <CatchBoundary
      getResetKey={() => "weekly-trending"}
      errorComponent={({ error, reset }) => (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-5">
          <SectionError
            error={error}
            reset={reset}
            queryKey={weeklyTrendingOptions.queryKey}
            title="hero carousel"
          />
        </div>
      )}
    >
      <Suspense fallback={<HeroSkeleton />}>
        <HeroCarouselContent />
      </Suspense>
    </CatchBoundary>
  </section>
);

export default HeroCarousel;
