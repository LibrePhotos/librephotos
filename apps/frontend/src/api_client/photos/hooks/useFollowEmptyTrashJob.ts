import type { Job, JobDetail } from "@librephotos/api-client";
import { serverKeys, statsKeys } from "@librephotos/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { notification } from "../../../service/notifications";
import { useFollowedJob } from "../../jobs/hooks/useFollowedJob";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

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
 * Follows the Empty trash job this tab started (`useEmptyTrashMutation`). Once it has ended it says
 * how it went and refreshes the photo grids and the counts. Returns the job's id while it is
 * followed, also on a trash page opened again while it runs; null otherwise.
 */
export function useFollowEmptyTrashJob(): string | null {
  const queryClient = useQueryClient();
  const report = useCallback(
    (ended: JobDetail) => {
      reportEmptyTrash(ended);
      invalidatePhotoLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      void queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
    },
    [queryClient]
  );
  return useFollowedJob("emptyTrash", report).jobId;
}
