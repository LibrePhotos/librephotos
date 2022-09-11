import { showNotification } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAlbumDateList } from "../actions/albumsActions";
import { fetchPeople } from "../actions/peopleActions";
import { api, useWorkerQuery } from "../api_client/api";
import { PhotosetType } from "../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../store/store";
import { selectUserSelfDetails } from "../store/user/userSelectors";
import type { IJobDetailSchema, IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

export enum WorkerState {
  SET_WORKER_AVAILABILITY = "set-worker-availability",
  SET_WORKER_RUNNING_JOB = "set-worker-running-job",
}

export function useWorkerStatus(): {
  currentData: IWorkerAvailabilityResponse | undefined;
  workerRunningJob: IJobDetailSchema;
} {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const workerRunningJob = useAppSelector(state => state.worker.job_detail);
  const [hadPreviousJob, setHadPreviousJob] = useState(false);

  const user = useAppSelector(selectUserSelfDetails);
  const { data: currentData } = useWorkerQuery(null, { pollingInterval: 2000 });

  const [previousJob, setPreviousJob] = useState(currentData);

  useEffect(() => {
    if (currentData?.job_detail?.job_id !== previousJob?.job_detail?.job_id) {
      setPreviousJob(currentData);
    }
  }, [currentData, previousJob?.job_detail?.job_id]);

  useEffect(() => {
    if (hadPreviousJob && workerRunningJob !== undefined && currentData?.job_detail === null) {
      showNotification({
        message: t("toasts.jobfinished", {
          job: previousJob?.job_detail?.job_type_str,
        }),
        title: workerRunningJob?.job_type_str,
        color: "teal",
      });

      if (workerRunningJob?.job_type_str.toLowerCase() === "train faces") {
        dispatch(api.endpoints.fetchIncompleteFaces.initiate({ inferred: false }));
        dispatch(api.endpoints.fetchIncompleteFaces.initiate({ inferred: true }));
        fetchPeople(dispatch);
      }
      if (workerRunningJob?.job_type_str.toLowerCase() === "scan photos") {
        fetchAlbumDateList(dispatch, {
          username: user.username,
          person_id: user.id,
          photosetType: PhotosetType.NONE,
        });
      }
    }

    if (currentData?.job_detail) {
      dispatch({ type: WorkerState.SET_WORKER_AVAILABILITY, payload: false });
      dispatch({
        type: WorkerState.SET_WORKER_RUNNING_JOB,
        payload: currentData?.job_detail,
      });
    } else {
      dispatch({ type: WorkerState.SET_WORKER_AVAILABILITY, payload: true });
    }
  }, [
    currentData,
    dispatch,
    hadPreviousJob,
    previousJob?.job_detail?.job_type_str,
    t,
    user.id,
    user.username,
    workerRunningJob,
  ]);

  useEffect(() => {
    if (workerRunningJob) {
      setHadPreviousJob(true);
    }
  }, [workerRunningJob]);
  return { workerRunningJob, currentData };
}
