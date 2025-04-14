import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";

export const ServerLogsQueryKeys = ['serverLogs'] as const;

export const useFetchServerLogsQuery = () => useQuery({
  queryKey: [...ServerLogsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get(`/serverlogs`);
    return response as string[];
  },
}); 