import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { EASE_CINEMATIC } from "@/features/Home/components/hero/animations";
import { getMediaPosterUrl, getMediaTitle, type TMDBMediaDetails } from "../../types";
import { HeroBackdrop } from "./HeroBackdrop";
import { HeroInfo } from "./HeroInfo";

interface MediaHeroProps {
  details: TMDBMediaDetails;
  mediaType: "movie" | "tv";
}

export const MediaHero = ({ details, mediaType }: MediaHeroProps) => {
  const title = getMediaTitle(details);
  const posterUrl = getMediaPosterUrl(details.poster_path, "w342");

  return (
    <section className="relative overflow-hidden bg-neutral-950">
      <HeroBackdrop backdropPath={details.backdrop_path} />

      {/* Back button */}
      <div className="relative mx-auto max-w-7xl px-5 pt-24 sm:px-8 lg:px-12">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full border border-white/10 bg-neutral-950/40 text-neutral-300 backdrop-blur-md hover:bg-white/10 hover:text-white"
        >
          <Link to="/">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
        </Button>
      </div>

      {/* Content */}
      <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-8 lg:px-12 lg:pb-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_CINEMATIC }}
          className="flex flex-col gap-8 md:flex-row md:items-end md:gap-10"
        >
          {/* Poster */}
          <div className="shrink-0 md:w-56 lg:w-64">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={`${title} poster`}
                  fetchPriority="high"
                  decoding="async"
                  className="aspect-2/3 w-full object-cover"
                />
              ) : (
                <div className="flex aspect-2/3 w-full items-center justify-center bg-neutral-800 text-4xl">
                  🎬
                </div>
              )}
            </div>
          </div>

          <HeroInfo details={details} mediaType={mediaType} />
        </motion.div>
      </div>
    </section>
  );
};