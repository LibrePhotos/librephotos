/**
 * A second click on a job button while that job is queued or running gets a 409
 * `job_already_running` carrying the running job's id (issue #2333). That is shown as
 * "already running" and the page follows the running job; it is not an error.
 */
import { ApiError } from "@librephotos/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobKeys } from "./keys";
import { startJob } from "./startJob";

const stubs = vi.hoisted(() => ({
  invalidateQueries: vi.fn<(filters: { queryKey: readonly unknown[] }) => Promise<void>>(),
  jobAlreadyRunning: vi.fn<() => void>(),
}));

vi.mock("../api", () => ({ queryClient: { invalidateQueries: stubs.invalidateQueries } }));
vi.mock("../../service/notifications", () => ({ notification: { jobAlreadyRunning: stubs.jobAlreadyRunning } }));

function refused(code: string, status: number, extra: Record<string, string> = {}) {
  return new ApiError(status, "/scanphotos/", `API error: ${status}`, {
    errors: [{ field: "detail", message: "Scan Photos is already running.", code, ...extra }],
  });
}

describe("startJob", () => {
  beforeEach(() => {
    stubs.invalidateQueries.mockReset().mockResolvedValue();
    stubs.jobAlreadyRunning.mockClear();
  });

  it("passes the server's answer through when the job was queued", async () => {
    await expect(startJob(() => Promise.resolve({ status: true, job_id: "new" }))).resolves.toEqual({
      alreadyRunning: false,
      data: { status: true, job_id: "new" },
    });
    expect(stubs.jobAlreadyRunning).not.toHaveBeenCalled();
  });

  it("follows the running job on a job_already_running 409", async () => {
    const start = await startJob(() => Promise.reject(refused("job_already_running", 409, { job_id: "running" })));

    expect(start).toEqual({ alreadyRunning: true, jobId: "running" });
    expect(stubs.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(stubs.invalidateQueries).toHaveBeenCalledWith({ queryKey: jobKeys.worker() });
    expect(stubs.invalidateQueries).toHaveBeenCalledWith({ queryKey: jobKeys.all });
  });

  it("rejects every other failure as before", async () => {
    const failure = refused("job_start_failed", 500);
    await expect(startJob(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(stubs.jobAlreadyRunning).not.toHaveBeenCalled();
  });
});
