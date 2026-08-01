import { cn } from "@/lib/utils";
import type { HeroMovie } from "../../types";

interface HeroIndicatorsProps {
  movies: HeroMovie[];
  activeIndex: number;
  progress: number;
  onSelect: (index: number) => void;
}

const HeroIndicators = ({
  movies,
  activeIndex,
  progress,
  onSelect,
}: HeroIndicatorsProps) => (
  <div
    className="flex items-center gap-2 sm:gap-2.5"
    role="tablist"
    aria-label="Featured movies"
  >
    {movies.map((movie, index) => {
      const isActive = index === activeIndex;

      return (
        <button
          key={movie.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-label={`Go to slide ${index + 1}: ${movie.title}`}
          onClick={() => onSelect(index)}
          className={cn(
            "relative h-1.5 overflow-hidden rounded-full bg-white/20 transition-all duration-300 hover:bg-white/40",
            isActive ? "w-10 bg-white/25 sm:w-14" : "w-4",
          )}
        >
          {isActive && (
            <span
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          )}
        </button>
      );
    })}
  </div>
);

export default HeroIndicators;
