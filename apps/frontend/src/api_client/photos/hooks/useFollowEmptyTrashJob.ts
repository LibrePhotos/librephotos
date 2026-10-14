import type { Job } from "@librephotos/api-client";
import { serverKeys, statsKeys } from "@librephotos/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { notification } from "../../../service/notifications";
import { useJobsQuery } from "../../jobs/hooks/useJobsQuery";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

// The newest of the user's own jobs: a job just started is on the first page.
const OWN_RECENT_JOBS = { page: 1, pageSize: 10, mine: true };

const countIn = (result: Job["result"], key: string): number | null => {
  const value = result?.[key];
  return typeof value === "number" ? value : null;
};

/** The toast for an Empty trash job that has ended, from the counts it keeps in its result. */
export function reportEmptyTrash(job: Pick<Job, "cancelled" | "failed" | "result">) {
  if (job.cancelled) {
    notification.jobCancelled();
    return;
  }
  const deleted = countIn(job.result, "deleted");
  const failed = countIn(job.result, "failed_count");
  if (deleted === null) {
    notification.trashEmptyFailed();
  } else if (failed) {
    notification.trashEmptiedWithErrors(deleted, failed);
  } else if (job.failed) {
    notification.trashEmptyFailed();
  } else {
    notification.trashEmptied(deleted);
  }
}

/**
 * Follows the Empty trash job `jobId` (null: none) through the job list, which polls while a job of
 * the user's is unfinished. Once it has ended it says how it went, refreshes the photo grids and
 * the counts, and calls `onEnded`. Returns the job while it is known.
 */
export function useFollowEmptyTrashJob(jobId: string | null, onEnded: () => void): Job | undefined {
  const queryClient = useQueryClient();
  const { data } = useJobsQuery(OWN_RECENT_JOBS, { enabled: jobId !== null });
  const job = jobId === null ? undefined : data?.results.find(candidate => candidate.job_id === jobId);
  const ended = job?.finished === true ? job : undefined;

  useEffect(() => {
    if (!ended) return;
    reportEmptyTrash(ended);
    invalidatePhotoLists(queryClient);
    void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    void queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
    onEnded();
  }, [ended, onEnded, queryClient]);

  return job;
}
