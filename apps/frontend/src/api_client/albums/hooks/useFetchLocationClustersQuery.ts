import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";

export type { LocationClusters } from "@librephotos/api-client";

export const useFetchLocationClustersQuery = () =>
  useQuery({
    queryKey: albumKeys.locationClusters(),
    queryFn: () => endpoints.fetchLocationClusters(apiClient),
  });
