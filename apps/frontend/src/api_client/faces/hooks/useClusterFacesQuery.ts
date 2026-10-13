import { endpoints, faceKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useClusterFacesQuery = () =>
  useQuery({
    queryKey: faceKeys.clusters(),
    queryFn: () => endpoints.fetchClusterFaces(apiClient),
  });
