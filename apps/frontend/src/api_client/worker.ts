import { useQuery } from '@tanstack/react-query';
import { fetchClient } from './api';
import type { IWorkerAvailabilityResponse } from '../store/worker/worker.zod';
import { WorkerAvailabilityResponse } from '../store/worker/worker.zod';

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