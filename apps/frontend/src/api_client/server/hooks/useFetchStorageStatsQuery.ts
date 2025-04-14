import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { z } from 'zod';


export const StorageStatsResponse = z.object({
    total_storage: z.number(),
    used_storage: z.number(),
    free_storage: z.number(),
  });
  
  export type StorageStatsResponse = z.infer<typeof StorageStatsResponse>;

export const useFetchStorageStatsQuery = () => useQuery({
  queryKey: [QueryKeys.storageStats],
  queryFn: async () => {
    const response = await fetchClient.get('/storagestats/');
    return StorageStatsResponse.parse(response);
  },
}); 