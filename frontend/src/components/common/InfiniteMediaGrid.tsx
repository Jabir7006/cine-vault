import { useEffect, useRef, type ReactNode } from "react";
import {
  useSuspenseInfiniteQuery,
  type InfiniteData,
  type QueryKey,
  type UseSuspenseInfiniteQueryOptions,
} from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import MovieCardSkeleton from "@/components/common/MovieCardSkeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TMDBPage<TData> {
  page: number;
  results: TData[];
  total_pages: number;
  total_results: number;
}

const EAGER_PER_PAGE = 6;

interface InfiniteMediaGridProps<
  TData,
  TPageParam,
  TQueryKey extends QueryKey,
> {
  options: UseSuspenseInfiniteQueryOptions<
    TMDBPage<TData>,
    Error,
    InfiniteData<TMDBPage<TData>>,
    TQueryKey,
    TPageParam
  >;
  renderItem: (item: TData, index: number, eager: boolean) => ReactNode;
  keyExtractor: (item: TData, index: number) => string | number;
  emptyMessage?: string;
  className?: string;
}

const GRID_CLASSNAME =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

function InfiniteMediaGrid<TData, TPageParam, TQueryKey extends QueryKey>({
  options,
  renderItem,
  keyExtractor,
  emptyMessage = "No items available right now.",
  className,
}: InfiniteMediaGridProps<TData, TPageParam, TQueryKey>) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery<
      TMDBPage<TData>,
      Error,
      InfiniteData<TMDBPage<TData>>,
      TQueryKey,
      TPageParam
    >(options);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const pages = data?.pages ?? [];
  const pageCount = pages.length;

  const shouldAutoFetch = pageCount === 1 && hasNextPage && !isFetchingNextPage;
  const showLoadMore = pageCount >= 2 && hasNextPage;

  // Auto-fetch only the second page silently when the sentinel approaches the viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && shouldAutoFetch) {
          void fetchNextPage();
        }
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, shouldAutoFetch]);

  // First EAGER_PER_PAGE items of each page load eagerly so posters appear
  // as soon as possible, then the rest load lazily in DOM order.
  const eagerIndices = new Set<number>();
  let offset = 0;
  for (const page of pages) {
    for (let i = 0; i < Math.min(EAGER_PER_PAGE, page.results.length); i++) {
      eagerIndices.add(offset + i);
    }
    offset += page.results.length;
  }

  const items = pages.flatMap((page) => page.results) ?? [];

  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className={className}>
      <div className={cn(GRID_CLASSNAME, "[overflow-anchor:none]")}>
        {items.map((item, index) => (
          <div key={keyExtractor(item, index)}>
            {renderItem(item, index, eagerIndices.has(index))}
          </div>
        ))}

        {/* Skeleton placeholders while a next page is being fetched */}
        {isFetchingNextPage &&
          Array.from({ length: 6 }).map((_, i) => (
            <MovieCardSkeleton key={`loading-${i}`} />
          ))}
      </div>

      {/* Sentinel for auto-fetch */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {/* Load More / End state */}
      <div className="mt-10 flex justify-center">
        {!hasNextPage ? (
          <p className="text-xs text-neutral-500">
            You've reached the end of the list.
          </p>
        ) : showLoadMore ? (
          <Button
            variant="outline"
            onClick={(e) => {
              e.currentTarget.blur();
              void fetchNextPage();
            }}
            disabled={isFetchingNextPage}
            className="rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
          >
            {isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
            {isFetchingNextPage ? "Loading..." : "Load More"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export const InfiniteMediaGridSkeleton = ({
  count = 18,
}: {
  count?: number;
}) => (
  <div className={GRID_CLASSNAME}>
    {Array.from({ length: count }).map((_, i) => (
      <MovieCardSkeleton key={i} />
    ))}
  </div>
);

export default InfiniteMediaGrid;
