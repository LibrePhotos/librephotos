import { useEffect, useState } from "react";
import { useWorkerQuery } from "../api_client/jobs/hooks";
import type { JobDetail } from "../api_client/jobs/types";

export function useWorkerStatus() {
  const { data: worker, isLoading } = useWorkerQuery();

  const [workerRunningJob, setWorkerRunningJob] = useState<JobDetail | null>(null);
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
    currentData: worker,
  };
}
