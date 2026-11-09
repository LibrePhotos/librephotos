import { endpoints } from "@librephotos/api-client";
import { apiClient } from "../api";

/**
 * Where a job the user started is, by the `job_id` its trigger answered with. A job is fetched by its
 * numeric `id` (`GET /jobs/{id}/`), which only the job list gives.
 */
export type JobLookup =
  | { state: "found"; id: number }
  /** Not on the user's whole list: removed (Remove finished jobs), or never theirs. */
  | { state: "gone" }
  /** Not among the newest LOOKUP_PAGE_SIZE of a longer list; looked for again later. */
  | { state: "notYet" };

// A job just started is among the newest, except a queued one on SQLite, which sorts unstarted jobs last.
const LOOKUP_PAGE_SIZE = 100;

export async function findOwnJob(jobId: string): Promise<JobLookup> {
  const page = await endpoints.fetchJobs(apiClient, 1, LOOKUP_PAGE_SIZE, { mine: true });
  const job = page.results.find(candidate => candidate.job_id === jobId);
  if (job) return { state: "found", id: job.id };
  return page.next === null ? { state: "gone" } : { state: "notYet" };
}
