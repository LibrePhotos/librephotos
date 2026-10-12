import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient } from "../../api";
import { faceKeys } from "../keys";

const DataPoint = z.object({
  x: z.number(),
  y: z.number(),
  size: z.number(),
});

const ClusterFaceDatapoint = z.object({
  person_id: z.number(),
  person_name: z.string(),
  // To-Do: Why ?
  person_label_is_inferred: z.boolean().nullable(),
  color: z.string(),
  face_url: z.string(),
  value: DataPoint,
});

const ClusterFaces = z.array(ClusterFaceDatapoint);

export type ClusterFacesResponse = z.infer<typeof ClusterFacesResponse>;
export const ClusterFacesResponse = z.object({
  status: z.boolean(),
  data: ClusterFaces,
});

const clusterFaces = () => apiClient.get<ClusterFacesResponse>("/clusterfaces");

export const useClusterFacesQuery = () =>
  useQuery<ClusterFacesResponse>({
    queryKey: faceKeys.clusters(),
    queryFn: () => clusterFaces(),
  });
