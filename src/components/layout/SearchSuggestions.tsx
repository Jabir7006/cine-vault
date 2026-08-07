import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Search, SearchX } from "lucide-react";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchOptions } from "@/features/search/queries";
import { SearchFilterTabs } from "@/features/search/components/SearchFilterTabs";
import { SearchResults } from "@/features/search/components/SearchResults";
import type { SearchFilter } from "@/features/search/types";
import type { TMDBMediaItem } from "@/features/Home/types";

interface SearchSuggestionsProps {
  query: string;
  isOpen: boolean;
  onSelect?: () => void;
}

const MAX_RESULTS = 8;

export const SearchSuggestions = ({
  query,
  isOpen,
  onSelect,
}: SearchSuggestionsProps) => {
  const [filter, setFilter] = useState<SearchFilter>("all");
  const debouncedQuery = useDebouncedValue(query, 500);

  const trimmedQuery = debouncedQuery.trim();
  const { data, isFetching, isError, isPlaceholderData } = useQuery(
    searchOptions(trimmedQuery, filter),
  );

  const results = useMemo(() => {
    if (!data?.results) return [];
    // Multi-search can return people; only keep movies & TV shows.
    // The /search/movie and /search/tv endpoints don't include media_type,
    // so normalize it from the active filter.
    return data.results
      .map((item) => ({
        ...item,
        media_type: filter === "all" ? item.media_type : filter,
      }))
      .filter(
        (item): item is TMDBMediaItem =>
          item.media_type === "movie" || item.media_type === "tv",
      )
      .slice(0, MAX_RESULTS);
  }, [data, filter]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="py-2"
        >
          {/* Filter tabs */}
          <div className="px-2 pb-2">
            <SearchFilterTabs value={filter} onValueChange={setFilter} />
          </div>

          {/* Content states */}
          {!trimmedQuery ? (
            <div className="flex flex-col items-center gap-3 py-6 text-neutral-400">
              <Search className="size-6 shrink-0" />
              <p className="text-sm text-center">
                Type to search movies & TV shows...
              </p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-neutral-400">
              <SearchX className="size-6 shrink-0" />
              <p className="text-sm text-center">
                Something went wrong. Please try again.
              </p>
            </div>
          ) : isFetching && !isPlaceholderData ? (
            <div className="flex items-center justify-center gap-2 py-6 text-neutral-400">
              <Loader2 className="size-5 animate-spin" />
              <p className="text-sm">Searching...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-neutral-400">
              <SearchX className="size-6 shrink-0" />
              <p className="text-sm text-center">
                No results found for "{trimmedQuery}"
              </p>
            </div>
          ) : (
            <SearchResults results={results} onSelect={onSelect} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};