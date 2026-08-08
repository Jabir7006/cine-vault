import { Skeleton } from "@/components/ui/skeleton";

export const MediaHeroSkeleton = () => (
  <section className="relative overflow-hidden bg-neutral-950">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)]" />
    <div className="relative mx-auto max-w-7xl px-5 pt-24 sm:px-8 lg:px-12">
      <Skeleton className="h-9 w-24 rounded-full" />
    </div>
    <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-8 lg:px-12 lg:pb-16">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:gap-10">
        <div className="shrink-0 md:w-56 lg:w-64">
          <Skeleton className="aspect-2/3 w-full rounded-2xl" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
          <Skeleton className="h-12 w-3/4 sm:h-14" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-20 w-full max-w-2xl" />
          <div className="flex gap-3 pt-2">
            <Skeleton className="h-11 w-36 rounded-full" />
            <Skeleton className="h-11 w-32 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  </section>
);