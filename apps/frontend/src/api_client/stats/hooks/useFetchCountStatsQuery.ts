import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useFetchCountStatsQuery = () =>
  useQuery({
    queryKey: statsKeys.counts(),
    queryFn: () => endpoints.fetchCountStats(apiClient),
  });
