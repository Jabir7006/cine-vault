import { useEffect, useRef, useState } from "react";

import { AUTOPLAY_INTERVAL } from "../components/hero/animations";

interface UseHeroAutoplayOptions {
  index: number;
  count: number;
  paused: boolean;
  interval?: number;
  onAdvance: () => void;
}

export const useHeroAutoplay = ({
  index,
  count,
  paused,
  interval = AUTOPLAY_INTERVAL,
  onAdvance,
}: UseHeroAutoplayOptions) => {
  const [progress, setProgress] = useState(0);
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;

  useEffect(() => {
    if (paused || count <= 1) return;

    setProgress(0);
    const startedAt = performance.now();

    let frameId: number;
    const tick = (now: number) => {
      const elapsed = (now - startedAt) / interval;

      if (elapsed >= 1) {
        setProgress(1);
        advanceRef.current();
        return;
      }

      setProgress(elapsed);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [index, paused, count, interval]);

  return progress;
};
