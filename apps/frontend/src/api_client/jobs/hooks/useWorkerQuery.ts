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
    refetchInterval: 2000, // Poll every 2 seconds
    enabled: options.enabled ?? true,
  });
