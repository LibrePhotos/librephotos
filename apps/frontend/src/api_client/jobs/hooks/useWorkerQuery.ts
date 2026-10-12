import { pollWhile } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { WorkerAvailabilityResponse } from "../types";

export const WorkerQueryKeys = ["worker"] as const;

type UseWorkerQueryOptions = {
  enabled?: boolean;
};

export const useWorkerQuery = (options: UseWorkerQueryOptions = {}) =>
  useQuery({
    queryKey: [...WorkerQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/rqavailable/");
      return parseWithNotification(WorkerAvailabilityResponse, response, "Failed to parse worker availability");
    },
    // Every two seconds while a job runs (the progress ring follows it); otherwise only often enough
    // to notice a job started elsewhere.
    refetchInterval: pollWhile<WorkerAvailabilityResponse>(worker => !worker.queue_can_accept_job),
    enabled: options.enabled ?? true,
  });
