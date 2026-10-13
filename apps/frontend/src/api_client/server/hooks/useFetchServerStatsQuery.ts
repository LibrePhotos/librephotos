import { endpoints, serverKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchServerStatsQuery = () =>
  useQuery({
    queryKey: serverKeys.stats(),
    queryFn: () => endpoints.fetchServerStats(apiClient),
  });
