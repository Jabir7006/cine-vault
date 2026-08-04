const TrendingSkeleton = () => (
  <div className="flex h-48 animate-pulse flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
    <div className="h-4 w-40 rounded-full bg-white/10" />
    <div className="h-3 w-56 rounded-full bg-white/10" />
  </div>
);

export default TrendingSkeleton;