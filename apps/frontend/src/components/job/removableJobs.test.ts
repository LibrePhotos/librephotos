/**
 * "Remove finished jobs" (#2908) takes out the finished jobs and keeps the ones later runs build on.
 */
import { describe, expect, it } from "vitest";
import { jobFixture } from "./jobFixture.test-utils";
import { removableFinishedJobs } from "./removableJobs";

const finished = { finished: true, finished_at: "2026-10-10T11:00:00Z", progress_current: 200 };

describe("removableFinishedJobs", () => {
  it("takes finished jobs, whether they completed, failed or were cancelled", () => {
    const jobs = [
      jobFixture({ id: 1, ...finished }),
      jobFixture({ id: 2, ...finished, failed: true, progress_current: 3 }),
      jobFixture({ id: 3, ...finished, cancelled: true }),
    ];

    expect(removableFinishedJobs(jobs).map(job => job.id)).toEqual([1, 2, 3]);
  });

  it("never takes a job that is running or queued", () => {
    const jobs = [jobFixture({ id: 1 }), jobFixture({ id: 2, started_at: null })];

    expect(removableFinishedJobs(jobs)).toEqual([]);
  });

  it("keeps the scan the next incremental scan starts from", () => {
    const jobs = [jobFixture({ id: 1, ...finished, is_scan_baseline: true }), jobFixture({ id: 2, ...finished })];

    expect(removableFinishedJobs(jobs).map(job => job.id)).toEqual([2]);
  });

  it("takes a scan from a server that does not say which one is the baseline", () => {
    const { is_scan_baseline: _unset, ...older } = jobFixture({ id: 1, ...finished });

    expect(removableFinishedJobs([older]).map(job => job.id)).toEqual([1]);
  });

  it("keeps a finished Add Geolocation run, but not one that was cut short or failed early", () => {
    const geolocation = { job_type: 11, job_type_str: "Add Geolocation", started_at: "2026-10-10T10:00:01Z" };
    const jobs = [
      jobFixture({ id: 1, ...finished, ...geolocation, progress_target: 200 }),
      jobFixture({ id: 2, ...finished, ...geolocation, progress_target: 200, cancelled: true }),
      jobFixture({ id: 3, ...finished, ...geolocation, progress_target: 200, failed: true, progress_current: 5 }),
    ];

    expect(removableFinishedJobs(jobs).map(job => job.id)).toEqual([2, 3]);
  });
});
