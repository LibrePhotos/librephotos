import { endpoints, POLL_ACTIVE_MS, pollUntil } from "@librephotos/api-client";
import { apiClient } from "../../api";

/** A job result's count `key`; 0 when the result lacks it (an older server). */
export const countIn = (result: Record<string, unknown> | null | undefined, key: string): number => {
  const value = result?.[key];
  return typeof value === "number" ? value : 0;
};

/**
 * The result of the user's own job `jobId` once it has ended, followed through the user's jobs. A
 * job that failed, was cancelled or left the list rejects. "Move to folder…" and "Rename files…"
 * follow their large runs this way, so their toast comes when the files are done.
 */
export async function ownJobResult(jobId: string): Promise<Record<string, unknown> | null | undefined> {
  const page = await pollUntil(() => endpoints.fetchJobs(apiClient, 1, 10, { mine: true }), {
    isDone: jobs => {
      const job = jobs.results.find(candidate => candidate.job_id === jobId);
      return job === undefined || job.finished;
    },
    intervalMs: POLL_ACTIVE_MS,
  });
  const job = page.results.find(candidate => candidate.job_id === jobId);
  if (job === undefined || job.failed || job.cancelled) {
    throw new Error(`The job ${jobId} did not finish`);
  }
  return job.result;
}
