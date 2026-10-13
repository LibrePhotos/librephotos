import { endpoints, serverKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchStorageStatsQuery = () =>
  useQuery({
    queryKey: serverKeys.storageStats(),
    queryFn: () => endpoints.fetchStorageStats(apiClient),
  });
