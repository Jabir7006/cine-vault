import { Skeleton } from "@/components/ui/skeleton";

const ProvidersSkeleton = () => (
  <div className="flex gap-3 overflow-hidden sm:gap-4">
    {Array.from({ length: 12 }).map((_, index) => (
      <Skeleton
        key={index}
        className="h-28 w-1/2 shrink-0 rounded-2xl border border-white/10 bg-white/5 sm:h-32 sm:w-1/3 md:w-1/4 lg:w-1/5 xl:w-1/6"
      />
    ))}
  </div>
);

export default ProvidersSkeleton;
