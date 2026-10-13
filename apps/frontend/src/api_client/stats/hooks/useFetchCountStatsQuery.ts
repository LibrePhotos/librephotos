import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchCountStatsQuery = () =>
  useQuery({
    queryKey: statsKeys.counts(),
    queryFn: () => endpoints.fetchCountStats(apiClient),
  });
