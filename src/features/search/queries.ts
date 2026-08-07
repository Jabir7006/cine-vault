import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { searchMedia } from "./api";
import type { SearchFilter } from "./types";

/**
 * Query options for TMDB search.
 * - Disabled when the query is empty/whitespace to avoid unnecessary requests.
 * - Uses keepPreviousData so switching filters doesn't cause a loading flicker.
 */
export const searchOptions = (query: string, filter: SearchFilter) =>
  queryOptions({
    queryKey: ["search", filter, query.trim()],
    queryFn: () => searchMedia(query.trim(), filter).then((res) => res.data),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });