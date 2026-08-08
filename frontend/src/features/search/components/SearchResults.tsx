import { Link } from "@tanstack/react-router";
import { Film, Tv } from "lucide-react";
import type { TMDBMediaItem } from "@/features/Home/types";

interface SearchResultsProps {
  results: TMDBMediaItem[];
  onSelect?: () => void;
}

const getPosterUrl = (posterPath: string | null): string => {
  if (!posterPath) return "";
  if (posterPath.startsWith("http")) return posterPath;
  return `https://image.tmdb.org/t/p/w92${posterPath}`;
};

const getTitle = (item: TMDBMediaItem): string =>
  item.title ||
  item.name ||
  item.original_title ||
  item.original_name ||
  "Untitled";

const getYear = (item: TMDBMediaItem): number | undefined => {
  const date = item.release_date || item.first_air_date;
  return date ? new Date(date).getFullYear() : undefined;
};

export const SearchResults = ({ results, onSelect }: SearchResultsProps) => (
  <ul className="max-h-80 overflow-y-auto scrollbar-thin [scrollbar-color:rgba(255,255,255,0.15)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:hover:bg-white/25">
    {results.map((item) => {
      const isTV = item.media_type === "tv";
      const title = getTitle(item);
      const year = getYear(item);
      const posterUrl = getPosterUrl(item.poster_path);

      return (
        <li key={`${item.media_type}-${item.id}`}>
          <Link
            to={isTV ? "/tv/$mediaId" : "/movie/$mediaId"}
            params={{ mediaId: String(item.id) }}
            onClick={onSelect}
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
          >
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={title}
                loading="lazy"
                decoding="async"
                className="size-10 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-800">
                {isTV ? (
                  <Tv className="size-4 text-neutral-500" />
                ) : (
                  <Film className="size-4 text-neutral-500" />
                )}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-200">
                {title}
              </p>
              {year && (
                <p className="text-xs text-neutral-500">{year}</p>
              )}
            </div>

            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              {isTV ? <Tv className="size-2.5" /> : <Film className="size-2.5" />}
              {isTV ? "TV" : "Movie"}
            </span>
          </Link>
        </li>
      );
    })}
  </ul>
);