import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";

import type { HeroMovie } from "@/features/Home/types";
import { HERO_MOVIES } from "@/features/Home/data";
import HeroBackdrop from "./HeroBackdrop";
import HeroContent from "./HeroContent";
import HeroControls from "./HeroControls";
import HeroIndicators from "./HeroIndicators";
import { useHeroAutoplay } from "@/features/Home/hooks/useHeroAutoplay";

const SWIPE_THRESHOLD = 48;

interface HeroCarouselProps {
  movies?: HeroMovie[];
}

const HeroCarousel = ({ movies = HERO_MOVIES }: HeroCarouselProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = movies.length;
  const activeMovie = movies[activeIndex];

  const goTo = useCallback(
    (index: number) => setActiveIndex((index + count) % count),
    [count],
  );
  const goNext = useCallback(
    () => setActiveIndex((current) => (current + 1) % count),
    [count],
  );
  const goPrev = useCallback(
    () => setActiveIndex((current) => (current - 1 + count) % count),
    [count],
  );

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

  return (
    <section
      aria-label="Featured movies"
      aria-roledescription="carousel"
      className="relative flex min-h-[82svh] w-full flex-col justify-end overflow-hidden bg-neutral-950 text-white sm:min-h-[88svh]"
      onMouseDownCapture={() => setPaused(true)}
      onMouseUpCapture={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence>
        <HeroBackdrop key={activeMovie.id} movie={activeMovie} />
      </AnimatePresence>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 pb-32 pt-24 sm:px-8 sm:pb-20 lg:px-12">
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
    </section>
  );
};

export default HeroCarousel;
