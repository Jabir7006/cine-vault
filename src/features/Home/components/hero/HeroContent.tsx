import { motion } from "framer-motion";
import { Clock, Info, Play, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { HeroMovie } from "@/features/Home/types";
import { contentItemVariants, contentVariants } from "./animations";

interface HeroContentProps {
  movie: HeroMovie;
}

const HeroContent = ({ movie }: HeroContentProps) => {
  const {
    title,
    tagline,
    description,
    rating,
    year,
    duration,
    ageRating,
    genres,
  } = movie;

  return (
    <motion.div
      role="group"
      aria-roledescription="slide"
      aria-label={title}
      variants={contentVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex max-w-3xl flex-col items-start gap-5"
    >
      <motion.div
        variants={contentItemVariants}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-neutral-300 sm:text-sm"
      >
        <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
          <Star className="size-3.5 fill-current" />
          {rating.toFixed(1)}
        </span>
        <span>{year}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" />
          {duration}
        </span>
        <span className="rounded border border-white/25 px-1.5 py-0.5 text-[10px] sm:text-xs">
          {ageRating}
        </span>
      </motion.div>

      <motion.p
        variants={contentItemVariants}
        className="text-xs font-medium uppercase tracking-[0.28em] text-neutral-300/90 sm:text-sm"
      >
        {tagline}
      </motion.p>

      <motion.h1
        variants={contentItemVariants}
        className="font-serif text-5xl font-bold italic leading-[0.95] tracking-tight text-white drop-shadow-lg sm:text-6xl lg:text-7xl"
      >
        {title}
      </motion.h1>

      <motion.div
        variants={contentItemVariants}
        className="flex flex-wrap gap-2"
      >
        {genres.map((genre) => (
          <span
            key={genre}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-neutral-200 backdrop-blur-md"
          >
            {genre}
          </span>
        ))}
      </motion.div>

      <motion.p
        variants={contentItemVariants}
        className="line-clamp-3 max-w-md text-sm leading-relaxed text-neutral-300 sm:max-w-xl sm:text-base"
      >
        {description}
      </motion.p>

      <motion.div
        variants={contentItemVariants}
        className="flex flex-wrap items-center gap-3 pt-1"
      >
        <Button className="h-11 gap-2 rounded-full bg-white px-6 text-neutral-950 shadow-xl hover:bg-white/90 sm:h-12 sm:px-7">
          <Play className="size-4 fill-current" />
          Play Now
        </Button>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-full border-white/20 bg-white/10 px-6 text-white backdrop-blur-md hover:bg-white/20 hover:text-white sm:h-12 sm:px-7"
        >
          <Info className="size-4" />
          More Details
        </Button>
      </motion.div>
    </motion.div>
  );
};

export default HeroContent;
