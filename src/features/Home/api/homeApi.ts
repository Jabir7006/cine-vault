import api from "@/lib/api";
import type { TMDBMediaItem, TMDBResponse } from "../types";

export const getWeeklyTrending = () => {
  return api.get<TMDBResponse<TMDBMediaItem>>("/trending/all/week?language=en-US");
};
