import type { Job } from "@librephotos/api-client";
import { useEffect } from "react";
import { useJobsQuery } from "./useJobsQuery";

// The newest of the user's own jobs: a job just started is on the first page.
const OWN_RECENT_JOBS = { page: 1, pageSize: 10, mine: true };

/**
 * Follows the user's own job `jobId` (null: none) through the job list, which polls while a job of
 * the user's is unfinished. Once it has ended it calls `onEnded` with it; the caller stops following
 * by passing null from then on. Returns the job while it is known.
 */
export function useFollowOwnJob(jobId: string | null, onEnded: (job: Job) => void): Job | undefined {
  const { data } = useJobsQuery(OWN_RECENT_JOBS, { enabled: jobId !== null });
  const job = jobId === null ? undefined : data?.results.find(candidate => candidate.job_id === jobId);
  const ended = job?.finished === true ? job : undefined;

  useEffect(() => {
    if (ended) onEnded(ended);
  }, [ended, onEnded]);

  return job;
}
