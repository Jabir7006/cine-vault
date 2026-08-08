import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MovieCardSkeletonProps {
  className?: string;
}

const MovieCardSkeleton = ({ className }: MovieCardSkeletonProps) => (
  <div
    className={cn(
      "relative aspect-2/3 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900",
      className,
    )}
  >
    {/* Poster placeholder */}
    <Skeleton className="absolute inset-0 rounded-none bg-white/10" />

    {/* Top row: media type + rating */}
    <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2.5 sm:p-3">
      <Skeleton className="h-5 w-20 rounded-full bg-white/10" />
      <Skeleton className="h-5 w-12 rounded-full bg-white/10" />
    </div>

    {/* Bottom content */}
    <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
      <Skeleton className="h-4 w-3/4 rounded-full bg-white/10" />
      <Skeleton className="mt-1 h-3 w-1/2 rounded-full bg-white/10" />
    </div>
  </div>
);

export default MovieCardSkeleton;
