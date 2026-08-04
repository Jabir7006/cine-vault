import { Skeleton } from "@/components/ui/skeleton";

const ProvidersSkeleton = () => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
    {Array.from({ length: 12 }).map((_, index) => (
      <Skeleton
        key={index}
        className="h-28 rounded-2xl border border-white/10 bg-white/5 sm:h-32"
      />
    ))}
  </div>
);

export default ProvidersSkeleton;
