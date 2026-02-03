import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { JobRequest, JobsResponse } from "../types";

export const JobsQueryKeys = ["jobs"] as const;

export const useJobsQuery = (params: JobRequest, options?: { pollingInterval?: number }) =>
  useQuery({
    queryKey: [...JobsQueryKeys, params],
    queryFn: async () => {
      const response = await fetchClient.get(`/jobs/?page_size=${params.pageSize ?? 10}&page=${params.page ?? 0}`);
      return parseWithNotification(JobsResponse, response, "Failed to parse jobs response");
    },
    refetchInterval: options?.pollingInterval,
  });
