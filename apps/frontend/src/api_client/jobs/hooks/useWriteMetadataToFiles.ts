import type { Job } from "@librephotos/api-client";
import { endpoints, jobKeys, settingsKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";
import { useFollowOwnJob } from "./useFollowOwnJob";

const countIn = (result: Job["result"], key: string): number => {
  const value = result?.[key];
  return typeof value === "number" ? value : 0;
};

/** The toast for a "Write metadata to files" job that has ended, from the counts in its result. */
export function reportWriteMetadata(job: Pick<Job, "cancelled" | "failed" | "result">) {
  if (job.cancelled) {
    notification.jobCancelled();
  } else if (job.failed) {
    notification.writeMetadataFailed();
  } else {
    notification.writeMetadataDone(countIn(job.result, "written"), countIn(job.result, "error_count"));
  }
}

/**
 * Write the edits already in LibrePhotos to the files (#2287): starts the job, follows it and says
 * how it went. `job` is the running job while the job list knows it (for its progress); `running`
 * is true from the click until the job ended.
 */
export function useWriteMetadataToFiles() {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.writeMetadataToFiles(apiClient));
      if (start.alreadyRunning) {
        return start.jobId;
      }
      notification.writeMetadataStarted();
      return start.data.job_id;
    },
    onSuccess: id => {
      setJobId(id);
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
  const report = useCallback(
    (ended: Job) => {
      reportWriteMetadata(ended);
      // A rotation written into a media file moves into the file: the counts change.
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      setJobId(null);
    },
    [queryClient]
  );
  const job = useFollowOwnJob(jobId, report);

  return { start: () => mutation.mutate(), running: jobId !== null || mutation.isPending, job };
}
