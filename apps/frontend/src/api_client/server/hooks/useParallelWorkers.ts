import { endpoints, serverKeys, type ParallelWorkers, type WorkerIntention } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useParallelWorkersQuery = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: serverKeys.parallelWorkers(),
    queryFn: () => endpoints.fetchParallelWorkers(apiClient),
    staleTime: 30 * 1000,
    enabled,
  });

export const useSetWorkerIntentionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (intention: WorkerIntention) => endpoints.setWorkerIntention(apiClient, intention),
    onSuccess: (status: ParallelWorkers) => queryClient.setQueryData(serverKeys.parallelWorkers(), status),
  });
};
