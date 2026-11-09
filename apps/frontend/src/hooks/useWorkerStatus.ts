import type { JobDetail } from "@librephotos/api-client";
import { useJobQueue } from "./useJobQueue";

/** The job the worker runs, when the user may see it; null before the server has answered too. */
export function useWorkerStatus(): { workerRunningJob: JobDetail | null } {
  return { workerRunningJob: useJobQueue().job };
}
