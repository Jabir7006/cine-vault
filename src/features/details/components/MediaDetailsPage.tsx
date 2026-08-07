import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";

import SectionError from "@/components/common/SectionError";
import { mediaDetailsOptions } from "../queries";
import type { MediaType } from "../types";
import { MediaHero } from "./hero/MediaHero";
import { CastSection } from "./cast/CastSection";
import { SimilarSection } from "./SimilarSection";
import { MediaHeroSkeleton } from "./skeletons/MediaHeroSkeleton";

interface MediaDetailsPageProps {
  mediaType: MediaType;
  mediaId: string;
}

const MediaDetailsContent = ({ mediaType, mediaId }: MediaDetailsPageProps) => {
  const { data: details } = useSuspenseQuery(
    mediaDetailsOptions(mediaType, mediaId),
  );

  return (
    <>
      <MediaHero details={details} mediaType={mediaType} />
      <CastSection cast={details.credits?.cast ?? []} />
      <SimilarSection similar={details.similar} mediaType={mediaType} />
    </>
  );
};

export const MediaDetailsPage = ({
  mediaType,
  mediaId,
}: MediaDetailsPageProps) => (
  <CatchBoundary
    getResetKey={() => `media-details-${mediaType}-${mediaId}`}
    errorComponent={({ error, reset }) => (
      <SectionError
        error={error}
        reset={reset}
        queryKey={mediaDetailsOptions(mediaType, mediaId).queryKey}
        title={mediaType === "movie" ? "movie" : "TV show"}
      />
    )}
  >
    <Suspense fallback={<MediaHeroSkeleton />}>
      <MediaDetailsContent mediaType={mediaType} mediaId={mediaId} />
    </Suspense>
  </CatchBoundary>
);