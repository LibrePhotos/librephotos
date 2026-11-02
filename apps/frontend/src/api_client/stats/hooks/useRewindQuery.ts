import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The user's year in photos (Rewind); only fetched while `year` is set. */
export const useRewindQuery = (year: number | null) =>
  useQuery({
    queryKey: statsKeys.rewind(year ?? 0),
    queryFn: () => endpoints.fetchRewind(apiClient, year ?? undefined),
    enabled: year !== null,
    // A year's photos change rarely while it is open; once per session is plenty.
    staleTime: Infinity,
  });
