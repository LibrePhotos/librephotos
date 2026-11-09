import type { Job } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { jobTypeLabel } from "./jobTypeLabel";

// Add Geolocation's next incremental run only covers photos added since its newest complete run
// (LongRunningJob.baselines in the backend). A scan's baseline comes from the server instead
// (is_scan_baseline), and the other jobs pick up what is left to do whatever ran before.
export const ADD_GEOLOCATION = 11;

type RemovableJob = Pick<
  Job,
  | "job_type"
  | "job_type_str"
  | "finished"
  | "started_at"
  | "cancelled"
  | "failed"
  | "progress_current"
  | "progress_target"
>;

/**
 * Whether the job went through all of its work, as LongRunningJob.baselines asks of a baseline:
 * not cancelled, and either not failed or failed only for item errors after reaching its target.
 */
export function ranToTheEnd(job: RemovableJob): boolean {
  const target = job.progress_target ?? 0;
  const reachedTarget = target > 0 && (job.progress_current ?? 0) >= target;
  return job.finished && job.started_at !== null && !job.cancelled && (!job.failed || reachedTarget);
}

/**
 * What removing the job loses. The scan the next incremental scan starts from cannot be removed
 * (see DeleteJobButton), so removing any other scan changes nothing in the library (#1104).
 */
export function removeJobMessage(job: RemovableJob, t: TFunction): string {
  if (!job.finished) {
    return t("confirmdialog.removejob.unfinished");
  }
  if (job.job_type === ADD_GEOLOCATION && ranToTheEnd(job)) {
    return t("confirmdialog.removejob.photobaseline", { job: jobTypeLabel(job, t) });
  }
  return t("confirmdialog.removejob.plain");
}
