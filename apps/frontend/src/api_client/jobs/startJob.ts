import { runningJobId } from "@librephotos/api-client";
import { notification } from "../../service/notifications";
import { queryClient } from "../api";
import { JobsQueryKeys } from "./hooks/useJobsQuery";
import { WorkerQueryKeys } from "./hooks/useWorkerQuery";

/** What a job trigger led to: the server's answer, or the job of its kind that is already running. */
type JobStart<T> = { alreadyRunning: false; data: T } | { alreadyRunning: true; jobId: string };

/**
 * Send a job trigger. When a job of its kind is already queued or running, the server answers
 * 409 `job_already_running` with that job's id. That is not an error for the user: this resolves
 * with the running job instead of rejecting, says so, and refreshes the worker status and the job
 * list so the page shows that job. Any other failure rejects as before.
 */
export async function startJob<T>(trigger: () => Promise<T>): Promise<JobStart<T>> {
  try {
    return { alreadyRunning: false, data: await trigger() };
  } catch (error) {
    const jobId = runningJobId(error);
    if (jobId === null) {
      throw error;
    }
    notification.jobAlreadyRunning();
    void queryClient.invalidateQueries({ queryKey: [...WorkerQueryKeys] });
    void queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
    return { alreadyRunning: true, jobId };
  }
}
