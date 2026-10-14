import { endpoints, jobKeys, pollWhile } from "@librephotos/api-client";
import type { JobListParams, JobsResponse } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type UseJobsQueryOptions = {
  /** Off until there is a job to follow (the trash page's Empty trash). */
  enabled?: boolean;
};

export const useJobsQuery = (params: JobListParams, options: UseJobsQueryOptions = {}) =>
  useQuery({
    queryKey: jobKeys.list(params),
    // `mine` is sent only when narrowing, so the admin list's request is unchanged.
    queryFn: () => endpoints.fetchJobs(apiClient, params.page ?? 0, params.pageSize ?? 10, { mine: params.mine }),
    // Fast only while a job on this page is unfinished; the idle cadence picks up new jobs.
    refetchInterval: pollWhile<JobsResponse>(page => page.results.some(job => !job.finished)),
    enabled: options.enabled ?? true,
  });
