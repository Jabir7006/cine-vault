import { queryOptions } from "@tanstack/react-query";
import { getWeeklyTrending } from "../api/homeApi";

export const weeklyTrendingOptions = queryOptions({
  queryKey: ["weekly-trending"],
  queryFn: () =>
    getWeeklyTrending().then((res) => res.data?.results.slice(0, 7)),
});
