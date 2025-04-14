import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { z } from 'zod';

export const ServerStatsQueryKeys = ['serverStats'] as const;

export const ServerStatsResponse = z.object({
    cpu_usage: z.number(),
    memory_usage: z.number(),
    disk_usage: z.number(),
    network_usage: z.number(),
    uptime: z.number(),
    last_updated: z.string(),
  });
  
  export type ServerStatsResponse = z.infer<typeof ServerStatsResponse>;

export const useFetchServerStatsQuery = () => useQuery({
  queryKey: [...ServerStatsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/serverstats/');
    return ServerStatsResponse.parse(response);
  },
}); 