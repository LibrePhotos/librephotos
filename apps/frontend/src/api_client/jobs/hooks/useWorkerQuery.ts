import { endpoints, jobKeys, pollWhile } from "@librephotos/api-client";
import type { WorkerAvailabilityResponse } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type UseWorkerQueryOptions = {
  enabled?: boolean;
};

export const useWorkerQuery = (options: UseWorkerQueryOptions = {}) =>
  useQuery({
    queryKey: jobKeys.worker(),
    queryFn: () => endpoints.fetchWorkerAvailability(apiClient),
    // Every two seconds while a job runs (the progress ring follows it); otherwise only often enough
    // to notice a job started elsewhere.
    refetchInterval: pollWhile<WorkerAvailabilityResponse>(worker => !worker.queue_can_accept_job),
    enabled: options.enabled ?? true,
  });
