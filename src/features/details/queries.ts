import { queryOptions } from "@tanstack/react-query";
import { getMediaDetails } from "./api";
import type { MediaType } from "./types";

/**
 * Query options for the TMDB details page (fetched via single append_to_response request).
 * Cached for 5 minutes to avoid redundant refetches.
 */
export const mediaDetailsOptions = (mediaType: MediaType, mediaId: string) =>
  queryOptions({
    queryKey: ["media-details", mediaType, mediaId],
    queryFn: () => getMediaDetails(mediaType, mediaId).then((res) => res.data),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });