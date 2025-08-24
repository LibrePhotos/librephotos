import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { WorkerAvailabilityResponse } from "../types";

export const WorkerQueryKeys = ['worker'] as const;

export const useWorkerQuery = () => useQuery({
    queryKey: [...WorkerQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/rqavailable/');
      return WorkerAvailabilityResponse.parse(response);
    },
    refetchInterval: 2000, // Poll every 2 seconds
  }); 