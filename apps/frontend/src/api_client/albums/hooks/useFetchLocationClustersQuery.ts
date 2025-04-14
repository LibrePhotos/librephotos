import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient } from "../../api";

export const LocationClustersQueryKeys = ['locationClusters'] as const;

export const LocationClusters = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClusters>;

export const useFetchLocationClustersQuery = () => useQuery({
  queryKey: [...LocationClustersQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/locclust/');
    return LocationClusters.parse(response);
  },
}); 