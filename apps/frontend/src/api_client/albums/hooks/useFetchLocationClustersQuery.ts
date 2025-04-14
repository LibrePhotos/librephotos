import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";

export const LocationClusters = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClusters>;

export const useFetchLocationClustersQuery = () => useQuery({
  queryKey: [QueryKeys.locationClusters],
  queryFn: async () => {
    const response = await fetchClient.get('/locclust/');
    return LocationClusters.parse(response);
  },
}); 