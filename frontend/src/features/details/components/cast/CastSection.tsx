import { Users } from "lucide-react";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import Section from "@/components/common/Section";
import SectionHeader from "@/components/common/SectionHeader";
import type { CastMember } from "../../types";
import { CastCard } from "./CastCard";

const MAX_CAST = 12;

interface CastSectionProps {
  cast: CastMember[];
}

export const CastSection = ({ cast }: CastSectionProps) => {
  const topCast = cast.slice(0, MAX_CAST);

  return (
    <Section
      id="cast-heading"
      glowClassName="-top-32 -right-32 bg-violet-600/15"
      glowClassName2="-bottom-32 -left-32 bg-indigo-600/15"
    >
      <SectionHeader
        id="cast-heading"
        className="mb-8 sm:mb-10"
        badgeLabel="Cast"
        badgeIcon={Users}
        badgeIconClassName="text-violet-400"
        title="Meet the cast"
        subtitle="The faces behind the story."
      />

      <CarouselWrapper
        items={topCast}
        renderItem={(member, index) => (
          <CastCard member={member} index={index} />
        )}
        keyExtractor={(member) => member.id}
        emptyMessage="No cast information available right now."
      />
    </Section>
  );
};