import { useState } from "react";
import { motion } from "framer-motion";
import { Film, Star, Tv } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { TMDBMediaItem } from "@/features/Home/types";
import { TMDB_GENRES } from "@/features/Home/types";
import { EASE_CINEMATIC } from "@/features/Home/components/hero/animations";
import { cn } from "@/lib/utils";

interface MovieCardProps {
  item: TMDBMediaItem;
  index?: number;
  className?: string;
  eager?: boolean;
  /** Override for discover endpoints which don't include media_type in results (e.g. /discover/tv). */
  mediaType?: "movie" | "tv";
  /** Wrap the card in a Link to the details page. Defaults to true. */
  linkToDetails?: boolean;
}

const getPosterUrl = (posterPath: string | null): string => {
  if (!posterPath) return "";
  if (posterPath.startsWith("http")) return posterPath;
  return `https://image.tmdb.org/t/p/w500${posterPath}`;
};

const MovieCard = ({
  item,
  index = 0,
  className,
  eager = false,
  mediaType,
  linkToDetails = true,
}: MovieCardProps) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const title =
    item.title ||
    item.name ||
    item.original_title ||
    item.original_name ||
    "Untitled";

  const releaseDate = item.release_date || item.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : undefined;

  const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
  const isTV = mediaType === "tv" || item.media_type === "tv";
  const mediaTypeLabel = isTV ? "TV Series" : "Movie";

  const genres = item.genre_ids
    ?.map((id) => TMDB_GENRES[id])
    .filter((name): name is string => Boolean(name))
    .slice(0, 2);

  const posterUrl = getPosterUrl(item.poster_path);
  const showPoster = posterUrl && !imageError;

  const content = (
    <>
      {/* Skeleton placeholder while the poster loads */}
      {showPoster && !imageLoaded && (
        <div className="absolute inset-0 animate-pulse bg-neutral-800" />
      )}

      {showPoster ? (
        <img
          src={posterUrl}
          alt={title}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "low"}
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={cn(
            "size-full object-cover transition-transform duration-500 group-hover:scale-110",
            imageLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-linear-to-br from-neutral-800 to-neutral-950">
          {isTV ? (
            <Tv className="size-10 text-neutral-600" />
          ) : (
            <Film className="size-10 text-neutral-600" />
          )}
        </div>
      )}

      {/* Gradient overlay for text legibility */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-neutral-950/95 via-neutral-950/20 to-neutral-950/30" />

      {/* Top row: media type + rating */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2.5 sm:p-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          {isTV ? <Tv className="size-2.5" /> : <Film className="size-2.5" />}
          {mediaTypeLabel}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          <Star className="size-3 fill-amber-400" />
          {rating}
        </span>
      </div>

      {/* Bottom content */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
        <h3 className="line-clamp-1 font-serif text-sm font-bold italic tracking-tight text-white sm:text-base">
          {title}
        </h3>
        {(year || (genres && genres.length > 0)) && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-300 sm:text-xs">
            {year && <span>{year}</span>}
            {year && genres && genres.length > 0 && <span>·</span>}
            {genres && genres.length > 0 && (
              <span className="line-clamp-1">{genres.join(" · ")}</span>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6 }}
      viewport={{ once: true, margin: "0px 0px -20px 0px" }}
      transition={{
        duration: 0.5,
        ease: EASE_CINEMATIC,
        delay: (index % 6) * 0.06,
      }}
      className={cn(
        "group relative aspect-2/3 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 transition-colors duration-300 hover:border-white/25 hover:bg-neutral-800",
        className,
      )}
    >
      {linkToDetails ? (
        <Link
          to={isTV ? "/tv/$mediaId" : "/movie/$mediaId"}
          params={{ mediaId: String(item.id) }}
          className="absolute inset-0"
          aria-label={title}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </motion.article>
  );
};

export default MovieCard;