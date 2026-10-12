import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";

export const LocationClusters = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClusters>;

export const useFetchLocationClustersQuery = () =>
  useQuery({
    queryKey: albumKeys.locationClusters(),
    queryFn: async () => {
      const response = await apiClient.get("/locclust/");
      return parseWithNotification(LocationClusters, response, "Failed to parse location clusters");
    },
  });
