import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchCameraStatsQuery = () =>
  useQuery({
    queryKey: statsKeys.cameraStats(),
    queryFn: () => endpoints.fetchCameraStats(apiClient),
  });
