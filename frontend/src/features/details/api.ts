import api from "@/lib/api";
import type { MediaType, TMDBMediaDetails } from "./types";

const APPEND_RESPONSE = [
  "credits",
  "videos",
  "similar",
  "watch/providers",
].join(",");

/**
 * Fetches all details page data (details + credits + videos + similar + watch providers)
 * Shared by Movie and TV features.
 */
export const getMediaDetails = (mediaType: MediaType, mediaId: string) => {
  return api.get<TMDBMediaDetails>(`/${mediaType}/${mediaId}`, {
    params: {
      language: "en-US",
      append_to_response: APPEND_RESPONSE,
    },
  });
};
