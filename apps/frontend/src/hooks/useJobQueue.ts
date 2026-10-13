import type { JobDetail } from "@librephotos/api-client";
import { useWorkerQuery } from "../api_client/jobs/hooks";

type JobQueue = {
  /** A job runs or waits, any user's: the queue takes no other one until it is done. */
  busy: boolean;
  /** That job, when the user may see it (they started it, or they are staff); otherwise null. */
  job: JobDetail | null;
};

/**
 * The job queue's state for buttons that start a job (#2237). Before the server has answered the
 * queue is not busy: the buttons stay usable instead of disabled with no reason, and the server
 * turns a second job away on its own.
 */
export function useJobQueue(): JobQueue {
  const { data: worker } = useWorkerQuery();
  return { busy: worker ? !worker.queue_can_accept_job : false, job: worker?.job_detail ?? null };
}
