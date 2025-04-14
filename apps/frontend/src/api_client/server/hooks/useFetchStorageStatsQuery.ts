import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { z } from 'zod';

export const StorageStatsQueryKeys = ['storageStats'] as const;

export const StorageStatsResponse = z.object({
    total_storage: z.number(),
    used_storage: z.number(),
    free_storage: z.number(),
  });
  
  export type StorageStatsResponse = z.infer<typeof StorageStatsResponse>;

export const useFetchStorageStatsQuery = () => useQuery({
  queryKey: [...StorageStatsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/storagestats/');
    return StorageStatsResponse.parse(response);
  },
}); 