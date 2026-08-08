import { motion, useReducedMotion } from "framer-motion";

import type { HeroMovie } from "@/features/Home/types";
import { backdropFadeVariants, backdropVariants } from "./animations";

interface HeroBackdropProps {
  movie: HeroMovie;
  isFirst?: boolean;
}

const HeroBackdrop = ({ movie, isFirst }: HeroBackdropProps) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={movie.id}
      variants={reduceMotion ? backdropFadeVariants : backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-hidden
      className="absolute inset-0"
    >
      <img
        src={movie.backdrop}
        alt=""
        loading={isFirst ? "eager" : "lazy"}
        fetchPriority={isFirst ? "high" : "auto"}
        className="h-full w-full object-cover object-center"
        draggable={false}
      />
      {/* Subtle left gradient only — keeps text readable without dimming the image */}
      <div className="absolute inset-0 bg-linear-to-r from-neutral-950/80 via-neutral-950/20 to-transparent" />
    </motion.div>
  );
};

export default HeroBackdrop;
