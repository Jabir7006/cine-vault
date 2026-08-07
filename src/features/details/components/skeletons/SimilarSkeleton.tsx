import MovieCardSkeleton from "@/components/common/MovieCardSkeleton";

export const SimilarSkeleton = () => (
  <div className="flex gap-3 overflow-hidden sm:gap-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <MovieCardSkeleton
        key={i}
        className="w-1/2 shrink-0 sm:w-1/3 md:w-1/4 lg:w-1/5 xl:w-1/6"
      />
    ))}
  </div>
);