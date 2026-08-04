import { motion } from "framer-motion";

import type { StreamingProvider } from "../../types";
import { EASE_CINEMATIC } from "../hero/animations";

interface ProviderCardProps {
  provider: StreamingProvider;
  index: number;
}

const ProviderCard = ({ provider, index }: ProviderCardProps) => (
  <motion.article
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    whileHover={{ y: -6 }}
    viewport={{ once: true, margin: "0px 0px -20px 0px" }}
    transition={{
      duration: 0.5,
      ease: EASE_CINEMATIC,
      delay: (index % 6) * 0.06,
    }}
    className="group flex h-28 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl transition-colors duration-300 hover:border-white/25 hover:bg-white/9 sm:h-32"
  >
    <img
      src={provider.logoUrl}
      alt={`${provider.name} logo`}
      loading="lazy"
      className="h-14 w-14 object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-110 sm:h-16 sm:w-16"
    />
    <span className="line-clamp-1 max-w-full text-xs font-medium text-neutral-300">
      {provider.name}
    </span>
  </motion.article>
);

export default ProviderCard;
