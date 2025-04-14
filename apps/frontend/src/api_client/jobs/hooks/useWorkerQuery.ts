import { useQuery } from '@tanstack/react-query';
import { fetchClient, QueryKeys } from "../../api";
import { WorkerAvailabilityResponse } from "../types";

export const useWorkerQuery = () => {
  return useQuery({
    queryKey: [QueryKeys.worker],
    queryFn: async () => {
      const response = await fetchClient.get('/rqavailable/');
      return WorkerAvailabilityResponse.parse(response);
    },
    refetchInterval: 2000, // Poll every 2 seconds
  });
}; 