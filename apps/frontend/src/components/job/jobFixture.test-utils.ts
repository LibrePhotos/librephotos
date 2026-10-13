import type { Job } from "@librephotos/api-client";

/** A running scan, as the job list shows it. */
export function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    id: 7,
    job_id: "abc",
    queued_at: "2026-10-10T10:00:00Z",
    started_at: "2026-10-10T10:00:01Z",
    finished_at: null,
    finished: false,
    failed: false,
    cancelled: false,
    job_type: 1,
    job_type_str: "Scan Photos",
    started_by: { id: 1, username: "admin", first_name: "", last_name: "" },
    progress_current: 50,
    progress_target: 200,
    ...overrides,
  };
}
