import { useState } from "react";
import { cn } from "@/lib/utils";
import { getMediaBackdropUrl } from "../../types";

interface HeroBackdropProps {
  backdropPath: string | null;
}

export const HeroBackdrop = ({ backdropPath }: HeroBackdropProps) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const backdropUrl = getMediaBackdropUrl(backdropPath);
  const showBackdrop = backdropUrl && !error;

  return (
    <div className="absolute inset-0">
      {showBackdrop ? (
        <img
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "size-full object-cover object-top",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <div className="size-full bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.2),transparent_60%)]" />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-neutral-950 via-neutral-950/70 to-neutral-950/40" />
      <div className="absolute inset-0 bg-linear-to-r from-neutral-950/90 via-neutral-950/40 to-transparent" />
    </div>
  );
};