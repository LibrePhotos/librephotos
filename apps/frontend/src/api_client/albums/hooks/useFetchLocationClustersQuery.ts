import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";

const LocationClustersResponseSchema = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClustersResponseSchema>;

export const useFetchLocationClustersQuery = () => useQuery({
  queryKey: [QueryKeys.locationClusters],
  queryFn: async () => {
    const response = await fetchClient.get('/locclust/');
    return LocationClustersResponseSchema.parse(response);
  },
}); 