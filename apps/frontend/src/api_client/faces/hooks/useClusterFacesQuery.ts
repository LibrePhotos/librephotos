import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { faceKeys } from "../keys";

export const useClusterFacesQuery = () =>
  useQuery({
    queryKey: faceKeys.clusters(),
    queryFn: () => endpoints.fetchClusterFaces(apiClient),
  });
