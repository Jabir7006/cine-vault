import { motion } from "framer-motion";
import { User } from "lucide-react";

import { EASE_CINEMATIC } from "@/features/Home/components/hero/animations";
import type { CastMember } from "../../types";

interface CastCardProps {
  member: CastMember;
  index: number;
}

const getProfileUrl = (profilePath: string | null): string =>
  profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : "";

export const CastCard = ({ member, index }: CastCardProps) => {
  const profileUrl = getProfileUrl(member.profile_path);

  return (
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
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl transition-colors duration-300 hover:border-white/25 hover:bg-white/9"
    >
      {profileUrl ? (
        <img
          src={profileUrl}
          alt={member.name}
          loading="lazy"
          decoding="async"
          className="aspect-2/3 w-full object-cover transition-transform duration-300 group-hover:scale-110"
        />
      ) : (
        <div className="flex aspect-2/3 w-full items-center justify-center bg-neutral-800">
          <User className="size-10 text-neutral-600" />
        </div>
      )}
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-semibold text-white">
          {member.name}
        </p>
        <p className="line-clamp-1 text-xs text-neutral-400">
          {member.character}
        </p>
      </div>
    </motion.article>
  );
};