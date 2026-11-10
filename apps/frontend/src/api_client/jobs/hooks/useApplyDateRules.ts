import type { Job, JobDetail } from "@librephotos/api-client";
import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../../photos/invalidatePhotoLists";
import { followedJobs } from "../followedJobs";
import { startJob } from "../startJob";
import { useFollowedJob } from "./useFollowedJob";

const countIn = (result: Job["result"], key: string): number => {
  const value = result?.[key];
  return typeof value === "number" ? value : 0;
};

/** The toast for an Apply date rules job that has ended, from the counts it keeps in its result. */
export function reportDateRules(job: Pick<Job, "cancelled" | "failed" | "result">) {
  if (job.cancelled) {
    notification.jobCancelled();
  } else if (job.failed) {
    notification.dateRulesFailed();
  } else {
    notification.dateRulesApplied(
      countIn(job.result, "moved"),
      countIn(job.result, "kept_hand_set"),
      countIn(job.result, "error_count")
    );
  }
}

/**
 * Apply date rules to existing photos (#437): starts the job that reads the date of every photo
 * again with the user's current date rules, then follows it and says how it went (photos moved,
 * photos that keep the date set by hand). `running` is true from the click until the job ended, on
 * every component that uses this hook, and again when a page is opened while the job still runs.
 */
export function useApplyDateRules() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.reapplyDateRules(apiClient));
      if (start.alreadyRunning) {
        return start.jobId;
      }
      notification.dateRulesStarted();
      return start.data.job_id;
    },
    onSuccess: id => {
      followedJobs.follow("applyDateRules", id);
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
  const report = useCallback(
    (ended: JobDetail) => {
      reportDateRules(ended);
      // The photos moved to other days: every grid and the timeline's day groups.
      invalidatePhotoLists(queryClient);
    },
    [queryClient]
  );
  const { jobId } = useFollowedJob("applyDateRules", report);

  return { start: () => mutation.mutate(), running: jobId !== null || mutation.isPending };
}
