import { useEffect, useState } from "react";

import { useWorkerQuery } from "../api_client/worker";
import type { IJobDetailSchema } from "../api_client/worker.zod";

export enum WorkerState {
  SET_WORKER_AVAILABILITY = "set-worker-availability",
  SET_WORKER_RUNNING_JOB = "set-worker-running-job",
}

export function useWorkerStatus() {
  const { data: worker, isLoading } = useWorkerQuery();

  const [workerRunningJob, setWorkerRunningJob] = useState<IJobDetailSchema | null>(null);
  const [workerAvailable, setWorkerAvailable] = useState<boolean>(false);

  useEffect(() => {
    if (worker) {
      setWorkerAvailable(worker.queue_can_accept_job);
      setWorkerRunningJob(worker.job_detail || null);
    }
  }, [worker]);

  return {
    workerRunningJob,
    workerAvailable,
    isLoading,
    currentData: worker
  };
}
