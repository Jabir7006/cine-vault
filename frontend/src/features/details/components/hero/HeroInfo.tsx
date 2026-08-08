import { Clock, Play, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMediaReleaseDate,
  getMediaRuntime,
  getMediaTitle,
  getMediaYear,
  type TMDBMediaDetails,
} from "../../types";
import { formatRuntime } from "./formatRuntime";

interface HeroInfoProps {
  details: TMDBMediaDetails;
  mediaType: "movie" | "tv";
}

export const HeroInfo = ({ details, mediaType }: HeroInfoProps) => {
  const title = getMediaTitle(details);
  const year = getMediaYear(details);
  const releaseDate = getMediaReleaseDate(details);
  const runtime = formatRuntime(getMediaRuntime(details));
  const genres = details.genres?.map((g) => g.name).slice(0, 3) ?? [];
  const rating = details.vote_average ? details.vote_average.toFixed(1) : "N/A";

  return (
    <div className="min-w-0 flex-1">
      {/* Badges */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-300 backdrop-blur-md">
          {mediaType === "movie" ? "Movie" : "TV Series"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-amber-400 backdrop-blur-md">
          <Star className="size-3 fill-amber-400" />
          {rating}
        </span>
      </div>

      <h1 className="font-serif text-4xl font-bold italic tracking-tight text-white sm:text-5xl lg:text-6xl">
        {title}
      </h1>

      {details.tagline && (
        <p className="mt-2 text-sm italic text-neutral-400 sm:text-base">
          {details.tagline}
        </p>
      )}

      {/* Meta row */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-300">
        {year && <span>{year}</span>}
        {runtime && (
          <>
            <span className="text-neutral-600">|</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {runtime}
            </span>
          </>
        )}
        {releaseDate && (
          <>
            <span className="text-neutral-600">|</span>
            <span>{releaseDate}</span>
          </>
        )}
      </div>

      {/* Genres */}
      {genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {genres.map((genre) => (
            <span
              key={genre}
              className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-neutral-300"
            >
              {genre}
            </span>
          ))}
        </div>
      )}

      {/* Overview */}
      {details.overview && (
        <p className="mt-5 line-clamp-3 max-w-2xl text-sm leading-relaxed text-neutral-300 sm:text-base">
          {details.overview}
        </p>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          className="rounded-full bg-white text-neutral-900 hover:bg-neutral-200 hover:text-neutral-900 shadow-lg"
        >
          <Play className="size-5 fill-current" />
          Play Now
        </Button>
        {details.homepage && (
          <Button
            asChild
            variant="ghost"
            size="lg"
            className="rounded-full border border-white/15 bg-white/5 text-neutral-200 backdrop-blur-md hover:bg-white/10 hover:text-white"
          >
            <a href={details.homepage} target="_blank" rel="noreferrer">
              Official Site
            </a>
          </Button>
        )}
      </div>
    </div>
  );
};