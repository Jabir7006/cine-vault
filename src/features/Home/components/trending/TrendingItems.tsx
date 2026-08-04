import { useSuspenseQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Film } from "lucide-react";

import { dailyTrendingOptions } from "../../hooks/useHomeQueries";
import { EASE_CINEMATIC } from "../hero/animations";

interface TrendingItemsProps {
  mediaType: "movie" | "tv";
}

const TrendingItems = ({ mediaType }: TrendingItemsProps) => {
  const { data: items } = useSuspenseQuery(dailyTrendingOptions(mediaType));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_CINEMATIC }}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/3 p-12 text-center backdrop-blur-md"
    >
      <Film className="size-6 text-neutral-500" />
      <p className="text-sm text-neutral-400">
        Loaded{" "}
        <span className="font-semibold text-neutral-200">{items.length}</span>{" "}
        trending {mediaType === "movie" ? "movies" : "TV shows"}.
      </p>
      <p className="text-xs text-neutral-500">
        Reusable movie cards &amp; carousel coming next.
      </p>
    </motion.div>
  );
};

export default TrendingItems;
