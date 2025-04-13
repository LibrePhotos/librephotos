import { useQuery } from '@tanstack/react-query';
import { fetchClient } from './api';
import type { IWorkerAvailabilityResponse } from './worker.zod';
import { WorkerAvailabilityResponse } from './worker.zod';

export const useWorkerQuery = () => {
  return useQuery({
    queryKey: ['worker'],
    queryFn: async () => {
      const response = await fetchClient.get('/rqavailable/');
      return WorkerAvailabilityResponse.parse(response);
    },
    refetchInterval: 2000, // Poll every 2 seconds
  });
}; 