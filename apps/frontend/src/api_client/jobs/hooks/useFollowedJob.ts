import type { JobDetail } from "@librephotos/api-client";
import { useCallback, useSyncExternalStore } from "react";
import { notification } from "../../../service/notifications";
import { followedJobs, type FollowedJobKind } from "../followedJobs";
import { useFollowJob, type JobFollow } from "./useFollowJob";

/**
 * Follows the job of `kind` this tab started (`followedJobs.follow`), from any component that shows
 * it: once it has ended, `report` says how it went; a job removed meanwhile says it can no longer be
 * followed. Either way the follow stops. `jobId` is the job still followed, null when there is none.
 */
export function useFollowedJob(
  kind: FollowedJobKind,
  report: (job: JobDetail) => void
): { jobId: string | null; follow: JobFollow } {
  const jobId = useSyncExternalStore(followedJobs.subscribe, () => followedJobs.get(kind));
  const onEnded = useCallback(
    (job: JobDetail) => {
      followedJobs.release(kind, job.job_id);
      report(job);
    },
    [kind, report]
  );
  const onLost = useCallback(() => {
    if (jobId !== null) followedJobs.release(kind, jobId);
    notification.jobLost();
  }, [kind, jobId]);
  const follow = useFollowJob(jobId, onEnded, onLost);
  return { jobId, follow };
}
