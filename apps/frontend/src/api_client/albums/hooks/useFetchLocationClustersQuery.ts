import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchLocationClustersQuery = () =>
  useQuery({
    queryKey: albumKeys.locationClusters(),
    queryFn: () => endpoints.fetchLocationClusters(apiClient),
  });
