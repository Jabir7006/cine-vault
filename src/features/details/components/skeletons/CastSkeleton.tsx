import { Skeleton } from "@/components/ui/skeleton";

export const CastSkeleton = () => (
  <div className="flex gap-3 overflow-hidden sm:gap-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="w-1/2 shrink-0 sm:w-1/3 md:w-1/4 lg:w-1/5 xl:w-1/6"
      >
        <Skeleton className="aspect-2/3 w-full rounded-2xl" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-1 h-3 w-1/2" />
      </div>
    ))}
  </div>
);