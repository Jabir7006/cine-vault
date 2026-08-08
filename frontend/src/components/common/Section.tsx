import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionProps {
  id: string;
  children: ReactNode;
  className?: string;
  glowClassName?: string;
  glowClassName2?: string;
}

const Section = ({
  id,
  children,
  className,
  glowClassName,
  glowClassName2,
}: SectionProps) => (
  <section
    aria-labelledby={id}
    className={cn(
      "relative overflow-hidden bg-neutral-950 py-12 sm:py-24",
      className,
    )}
  >
    <div
      className={cn(
        "pointer-events-none absolute size-96 rounded-full blur-[120px]",
        glowClassName,
      )}
    />
    <div
      className={cn(
        "pointer-events-none absolute size-96 rounded-full blur-[120px]",
        glowClassName2,
      )}
    />

    <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
      {children}
    </div>
  </section>
);

export default Section;
