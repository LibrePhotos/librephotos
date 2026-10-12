import { endpoints, pollWhile } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { jobKeys } from "../keys";
import type { JobRequest, JobsResponse } from "../types";

export const useJobsQuery = (params: JobRequest) =>
  useQuery({
    queryKey: jobKeys.list(params),
    // `mine` is sent only when narrowing, so the admin list's request is unchanged.
    queryFn: () => endpoints.fetchJobs(apiClient, params.page ?? 0, params.pageSize ?? 10, { mine: params.mine }),
    // Fast only while a job on this page is unfinished; the idle cadence picks up new jobs.
    refetchInterval: pollWhile<JobsResponse>(page => page.results.some(job => !job.finished)),
  });
