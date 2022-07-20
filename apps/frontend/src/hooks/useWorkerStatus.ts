import { showNotification } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAlbumDateList } from "../actions/albumsActions";
import { FacesActions, fetchInferredFacesList, fetchLabeledFacesList } from "../actions/facesActions";
import { fetchPeople } from "../actions/peopleActions";
import { useWorkerQuery } from "../api_client/api";
import { PhotosetType } from "../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../store/store";
import { selectUserSelfDetails } from "../store/user/userSelectors";
import type { IJobDetailSchema, IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

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

  useEffect(() => {
    if (hadPreviousJob && workerRunningJob !== undefined && currentData?.job_detail === null) {
      showNotification({
        message: t("toasts.jobfinished", {
          job: workerRunningJob?.job_type_str,
        }),
        title: workerRunningJob?.job_type_str,
        color: "teal",
      });

      if (workerRunningJob?.job_type_str.toLowerCase() === "train faces") {
        dispatch(fetchLabeledFacesList());
        dispatch(fetchInferredFacesList());
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
      dispatch({ type: FacesActions.SET_WORKER_AVAILABILITY, payload: false });
      dispatch({
        type: FacesActions.SET_WORKER_RUNNING_JOB,
        payload: currentData?.job_detail,
      });
    } else {
      dispatch({ type: FacesActions.SET_WORKER_AVAILABILITY, payload: true });
    }
  }, [currentData, dispatch, hadPreviousJob, t, user.id, user.username, workerRunningJob]);

  useEffect(() => {
    if (workerRunningJob) {
      setHadPreviousJob(true);
    }
  }, [workerRunningJob]);
  return { workerRunningJob, currentData };
}
