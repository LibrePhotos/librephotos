import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useWorkerQuery } from "../api_client/worker";
import { PhotosetType } from "../reducers/photosReducer";
import { notification } from "../service/notifications";
import { useAppSelector } from "../store/store";
import { selectUserSelfDetails } from "../store/user/userSelectors";
import type { IJobDetailSchema, IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

export enum WorkerState {
  SET_WORKER_AVAILABILITY = "set-worker-availability",
  SET_WORKER_RUNNING_JOB = "set-worker-running-job",
}

export function useWorkerStatus() {
  const { t } = useTranslation();
  const userSelfDetails = useAppSelector(selectUserSelfDetails);
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
  };
}
