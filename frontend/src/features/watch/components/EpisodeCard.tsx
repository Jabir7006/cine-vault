import { useState } from "react";
import { Play, Star, Tv } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEpisodeRating, isUpcomingEpisode } from "../episodes";
import type { TMDBEpisode } from "../types";

interface EpisodeCardProps {
  episode: TMDBEpisode;
  selected: boolean;
  todayUTC: string;
  onSelect: () => void;
}

export const EpisodeCard = ({ episode, selected, todayUTC, onSelect }: EpisodeCardProps) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const upcoming = isUpcomingEpisode(episode.air_date, todayUTC);
  const rating = getEpisodeRating(episode);
  const showImage = episode.still_path && !imageError;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={upcoming}
      aria-current={selected ? "true" : undefined}
      aria-label={`Episode ${episode.episode_number}: ${episode.name}${selected ? ", playing" : ""}${upcoming ? ", upcoming" : ""}`}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-neutral-900 p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed sm:gap-4 sm:p-3",
        selected ? "border-amber-400/70 bg-amber-400/5" : "border-white/10 enabled:hover:border-white/30 enabled:hover:bg-neutral-800",
        upcoming && "opacity-60",
      )}
    >
      <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-neutral-800 sm:w-36">
        {showImage && !imageLoaded ? <span className="absolute inset-0 animate-pulse bg-neutral-800" /> : null}
        {showImage ? (
          <img
            src={`https://image.tmdb.org/t/p/w300${episode.still_path}`}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={cn("size-full object-cover transition-opacity", imageLoaded ? "opacity-100" : "opacity-0")}
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-linear-to-br from-neutral-800 to-neutral-950">
            <Tv aria-hidden="true" className="size-6 text-neutral-600 sm:size-8" />
          </span>
        )}
        {selected ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play aria-hidden="true" className="size-5 fill-amber-400 text-amber-400" />
          </span>
        ) : null}
      </span>
      <span className="block min-w-0 flex-1 space-y-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-neutral-400">Episode {episode.episode_number}</span>
          {selected ? <span className="font-semibold text-amber-400">Playing</span> : null}
          {upcoming ? <span className="text-amber-400">Upcoming</span> : null}
        </span>
        <span className="block line-clamp-2 text-sm font-semibold text-white">{episode.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          <span className={cn("inline-flex items-center gap-1", rating === "Not rated" ? "text-neutral-500" : "text-amber-400")}>
            {rating !== "Not rated" ? <Star aria-hidden="true" className="size-3 fill-amber-400" /> : null}
            {rating}
          </span>
          {episode.air_date ? <time dateTime={episode.air_date}>{episode.air_date}</time> : null}
          {episode.runtime ? <span>{episode.runtime} min</span> : null}
        </span>
      </span>
    </button>
  );
};
