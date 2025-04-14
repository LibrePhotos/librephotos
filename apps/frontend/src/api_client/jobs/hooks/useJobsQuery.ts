import { useQuery } from '@tanstack/react-query';
import { fetchClient, QueryKeys } from "../../api";
import { JobRequest, JobsResponse } from "../types";

export const useJobsQuery = (params: JobRequest, options?: { pollingInterval?: number }) => 
  useQuery({
    queryKey: [QueryKeys.jobs, params],
    queryFn: async () => {
      const response = await fetchClient.get(`/jobs/?page_size=${params.pageSize ?? 10}&page=${params.page ?? 0}`);
      return JobsResponse.parse(response);
    },
    refetchInterval: options?.pollingInterval,
  }); 