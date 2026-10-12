import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { serverKeys } from "../keys";

export const useFetchServerStatsQuery = () =>
  useQuery({
    queryKey: serverKeys.stats(),
    queryFn: () => endpoints.fetchServerStats(apiClient),
  });
