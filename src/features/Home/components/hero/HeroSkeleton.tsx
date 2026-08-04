import { Skeleton } from "@/components/ui/skeleton";

const HeroSkeleton = () => (
  <>
    {/* Backdrop placeholder */}
    <div className="absolute inset-0 bg-neutral-900/40" />
    <div className="absolute inset-0 bg-linear-to-r from-neutral-950/80 via-neutral-950/20 to-transparent" />

    {/* Content */}
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 pb-24 pt-24 sm:px-8 sm:pb-20 lg:px-12">
        {/* HeroContent area */}
        <div className="flex max-w-3xl flex-col items-start gap-5">
          {/* Meta info row: rating, year, duration, ageRating */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Skeleton className="h-4 w-16 rounded-full bg-neutral-800/60" />
            <Skeleton className="h-4 w-12 rounded-full bg-neutral-800/60" />
            <Skeleton className="h-4 w-20 rounded-full bg-neutral-800/60" />
            <Skeleton className="h-5 w-12 rounded border border-white/25 bg-neutral-800/60" />
          </div>

          {/* Tagline */}
          <Skeleton className="h-4 w-32 bg-neutral-800/60" />

          {/* Title */}
          <Skeleton className="h-12 w-3/4 max-w-lg bg-neutral-800/80 sm:h-16 lg:h-20" />

          {/* Genre pills */}
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20 rounded-full bg-neutral-800/60" />
            <Skeleton className="h-7 w-20 rounded-full bg-neutral-800/60" />
          </div>

          {/* Description (3 lines matching line-clamp-3) */}
          <div className="flex w-full max-w-md flex-col gap-2 sm:max-w-xl">
            <Skeleton className="h-4 w-full bg-neutral-800/40" />
            <Skeleton className="h-4 w-full bg-neutral-800/40" />
            <Skeleton className="h-4 w-2/3 bg-neutral-800/40" />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <Skeleton className="h-11 w-32 rounded-full bg-neutral-800/80 sm:h-12" />
            <Skeleton className="h-11 w-36 rounded-full bg-neutral-800/50 sm:h-12" />
          </div>
        </div>

        {/* Indicators + Controls row */}
        <div className="flex items-end justify-between gap-4">
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-2 w-8 rounded-full bg-neutral-800/60"
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Skeleton className="size-10 rounded-full bg-neutral-800/60" />
            <Skeleton className="size-10 rounded-full bg-neutral-800/60" />
          </div>
        </div>
      </div>
    </div>
  </>
);

export default HeroSkeleton;
