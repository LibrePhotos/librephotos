import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { serverKeys } from "../keys";

export const useFetchStorageStatsQuery = () =>
  useQuery({
    queryKey: serverKeys.storageStats(),
    queryFn: () => endpoints.fetchStorageStats(apiClient),
  });
