export type JobOutcome = "queued" | "running" | "failed" | "cancelled" | "partial_failure" | "completed";

type JobState = Readonly<{
  finished: boolean;
  failed?: boolean;
  cancelled?: boolean;
  started_at?: string | null;
  result?: Record<string, unknown> | null;
}>;

/**
 * One reading of a job's state for the list, its progress bar and the detail
 * page, so the three cannot disagree.
 *
 * Only a hard failure is "failed": a scan that errored on a minority of its
 * files reports "partial_failure" and still sets result.error. A cancelled job
 * is finished but not failed (LongRunningJob.cancel()), so without its own
 * branch it read as a success.
 */
export function jobOutcome(job: JobState): JobOutcome {
  if (!job.finished) {
    return job.started_at ? "running" : "queued";
  }
  if (job.failed || job.result?.status === "failed") return "failed";
  if (job.cancelled || job.result?.status === "cancelled") return "cancelled";
  if (job.result?.status === "partial_failure") return "partial_failure";
  return "completed";
}

export const JOB_OUTCOME_COLOR: Record<JobOutcome, string> = {
  queued: "blue",
  running: "yellow",
  failed: "red",
  cancelled: "gray",
  partial_failure: "orange",
  completed: "green",
};
