import { Skeleton } from "@/components/ui/skeleton";

const HeroSkeleton = () => {
  return (
    <section className="relative h-[85svh] w-full overflow-hidden bg-neutral-950 text-white md:h-[90svh] lg:h-[92svh]">
      <div className="absolute inset-0 bg-neutral-900/40" />
      <div className="absolute inset-0 bg-linear-to-r from-neutral-950/90 via-neutral-950/40 to-transparent" />

      <div className="absolute inset-0 z-10 flex flex-col justify-end">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 pb-24 pt-24 sm:px-8 sm:pb-20 lg:px-12">
          <Skeleton className="h-4 w-32 bg-neutral-800/60" />
          <Skeleton className="h-12 w-3/4 max-w-lg bg-neutral-800/80 sm:h-16" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-full bg-neutral-800/60" />
            <Skeleton className="h-6 w-20 rounded-full bg-neutral-800/60" />
          </div>
          <Skeleton className="h-16 w-full max-w-xl bg-neutral-800/40" />
          <div className="flex gap-3 pt-2">
            <Skeleton className="h-11 w-32 rounded-full bg-neutral-800/80 sm:h-12" />
            <Skeleton className="h-11 w-36 rounded-full bg-neutral-800/50 sm:h-12" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSkeleton;
