import type { Transition, Variants } from "framer-motion";

export const AUTOPLAY_INTERVAL = 6000;

const EASE_CINEMATIC: [number, number, number, number] = [0.22, 1, 0.36, 1];

const CROSSFADE: Transition = { duration: 0.9, ease: EASE_CINEMATIC };

export const backdropVariants: Variants = {
  initial: { opacity: 0, scale: 1.08 },
  animate: { opacity: 1, scale: 1, transition: CROSSFADE },
  exit: { opacity: 0, transition: { duration: 0.7, ease: EASE_CINEMATIC } },
};

export const backdropFadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.9, ease: EASE_CINEMATIC } },
  exit: { opacity: 0, transition: { duration: 0.5, ease: EASE_CINEMATIC } },
};

export const contentVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.35, ease: EASE_CINEMATIC } },
};

export const contentItemVariants: Variants = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_CINEMATIC } },
};
