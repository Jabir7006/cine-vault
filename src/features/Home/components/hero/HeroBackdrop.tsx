import { motion, useReducedMotion } from "framer-motion";

import type { HeroMovie } from "@/features/Home/types";
import { backdropFadeVariants, backdropVariants } from "./animations";

interface HeroBackdropProps {
  movie: HeroMovie;
}

const HeroBackdrop = ({ movie }: HeroBackdropProps) => {
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
        className="h-full w-full object-cover object-center"
        draggable={false}
      />
      <div className="absolute inset-0 bg-linear-to-r from-neutral-950/95 via-neutral-950/55 to-neutral-950/20" />
      <div className="absolute inset-0 bg-linear-to-t from-neutral-950 via-neutral-950/10 to-neutral-950/50" />
      <div className="absolute inset-0 bg-neutral-950/20" />
    </motion.div>
  );
};

export default HeroBackdrop;
