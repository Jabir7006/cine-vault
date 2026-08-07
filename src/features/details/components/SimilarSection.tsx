import { Layers } from "lucide-react";

import CarouselWrapper from "@/components/common/CarouselWrapper";
import MovieCard from "@/components/common/MovieCard";
import Section from "@/components/common/Section";
import SectionHeader from "@/components/common/SectionHeader";
import type { TMDBMediaItem } from "@/features/Home/types";
import type { MediaType, SimilarMediaPart } from "../types";

interface SimilarSectionProps {
  similar: SimilarMediaPart | undefined;
  mediaType: MediaType;
}

export const SimilarSection = ({ similar, mediaType }: SimilarSectionProps) => {
 
  const items: TMDBMediaItem[] = (similar?.results ?? []).map((item) => ({
    ...item,
    media_type: mediaType,
  }));

  return (
    <Section
      id="similar-heading"
      glowClassName="-top-32 -left-32 bg-amber-600/15"
      glowClassName2="-bottom-32 -right-32 bg-orange-600/15"
    >
      <SectionHeader
        id="similar-heading"
        className="mb-8 sm:mb-10"
        badgeLabel="More Like This"
        badgeIcon={Layers}
        badgeIconClassName="text-amber-400"
        title={mediaType === "movie" ? "Similar movies" : "Similar shows"}
        subtitle="If you loved this, you might enjoy these."
      />

      <CarouselWrapper
        items={items}
        renderItem={(item, index) => (
          <MovieCard
            item={item}
            index={index}
            mediaType={mediaType}
            linkToDetails
          />
        )}
        keyExtractor={(item) => item.id}
        emptyMessage={`No similar ${
          mediaType === "movie" ? "movies" : "shows"
        } available right now.`}
      />
    </Section>
  );
};