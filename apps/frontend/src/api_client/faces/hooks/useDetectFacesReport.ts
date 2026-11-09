import { photoKeys, type JobDetail } from "@librephotos/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { notification } from "../../../service/notifications";
import { useFollowJob } from "../../jobs/hooks/useFollowJob";
import { detectFacesReports } from "../detectFacesReports";

/** What Detect faces again found on one photo (#1117), or null when it was not run on it. */
export type DetectFacesOutcome = Readonly<{
  state: "running" | "found" | "none" | "failed";
  /** The faces the scan added, to mark them as new. */
  newFaceIds: readonly number[];
  dismiss: () => void;
}>;

const noReport = () => undefined;

/**
 * Follows a Detect faces again of the photo `photoId` (started by `useDetectFacesAgainMutation`
 * for a single photo). Once the job has ended, the photo's details are fetched
 * again and its faces (`faceIds`) compared with those it had before.
 */
export function useDetectFacesReport(
  photoId: string | undefined,
  faceIds: readonly number[]
): DetectFacesOutcome | null {
  const queryClient = useQueryClient();
  const report = useSyncExternalStore(
    detectFacesReports.subscribe,
    photoId ? () => detectFacesReports.get(photoId) : noReport
  );

  useEffect(() => {
    if (photoId && report?.before === null) detectFacesReports.remember(photoId, faceIds);
  }, [photoId, report, faceIds]);

  const onEnded = useCallback(
    (job: Pick<JobDetail, "job_id" | "failed">) => {
      if (!photoId) return;
      // The scan's faces are in the photo's details once they are fetched again
      void queryClient
        .invalidateQueries({ queryKey: photoKeys.details() })
        .then(() => detectFacesReports.finish(photoId, job.job_id, job.failed));
    },
    [photoId, queryClient]
  );
  const runningJobId = report?.state === "running" ? report.jobId : null;
  const onLost = useCallback(() => {
    if (photoId && runningJobId) detectFacesReports.lose(photoId, runningJobId);
    notification.jobLost();
  }, [photoId, runningJobId]);
  useFollowJob(runningJobId, onEnded, onLost);

  if (!photoId || !report) return null;
  const dismiss = () => detectFacesReports.dismiss(photoId);
  if (report.state !== "done") return { state: report.state, newFaceIds: [], dismiss };
  const before = new Set(report.before ?? faceIds);
  const newFaceIds = faceIds.filter(id => !before.has(id));
  return { state: newFaceIds.length > 0 ? "found" : "none", newFaceIds, dismiss };
}
