import type { Job } from "@librephotos/api-client";
import { ADD_GEOLOCATION, ranToTheEnd } from "./DeleteJobButton";

/**
 * The jobs "Remove finished jobs" takes out (#2908): the finished ones, except those later runs
 * build on. The scan the next incremental scan starts from cannot be removed (the server refuses
 * it, 409 scan_baseline), and a finished Add Geolocation run is what the next one is measured
 * against (see DeleteJobButton), so both stay. A job still running or queued is never touched.
 */
export function removableFinishedJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter(
    job => job.finished && job.is_scan_baseline !== true && !(job.job_type === ADD_GEOLOCATION && ranToTheEnd(job))
  );
}
