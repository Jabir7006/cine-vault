import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { EASE_CINEMATIC } from "../../features/Home/components/hero/animations";

interface SectionHeaderProps {
  badgeLabel: string;
  title: string;
  subtitle?: string;
  id?: string;
  badgeIcon?: LucideIcon;
  badgeIconClassName?: string;
  className?: string;
}

const SectionHeader = ({
  badgeLabel,
  title,
  subtitle,
  id,
  badgeIcon: BadgeIcon,
  badgeIconClassName,
  className,
}: SectionHeaderProps) => (
  <motion.header
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.6, ease: EASE_CINEMATIC }}
    className={cn("mb-10 flex flex-col gap-3 sm:mb-12", className)}
  >
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-300 backdrop-blur-md">
      {BadgeIcon && (
        <BadgeIcon className={cn("size-3.5", badgeIconClassName)} />
      )}
      {badgeLabel}
    </span>
    <h2
      id={id}
      className="font-serif text-3xl font-bold italic tracking-tight text-white sm:text-4xl lg:text-5xl"
    >
      {title}
    </h2>
    {subtitle && (
      <p className="max-w-xl text-sm leading-relaxed text-neutral-400 sm:text-base">
        {subtitle}
      </p>
    )}
  </motion.header>
);

export default SectionHeader;
