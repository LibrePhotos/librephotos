import { showNotification } from "@mantine/notifications";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { fetchAlbumDateList } from "../actions/albumsActions";
import { fetchInferredFacesList, fetchLabeledFacesList } from "../actions/facesActions";
import { fetchPeople } from "../actions/peopleActions";
import { useWorkerQuery } from "../api_client/api";
import { PhotosetType } from "../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../store/store";
import { selectUserSelfDetails } from "../store/user/userSelectors";
import { IJobDetailSchema, IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

export function useWorkerStatus(): {
  currentData: IWorkerAvailabilityResponse | undefined;
  workerRunningJob: IJobDetailSchema;
} {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const workerRunningJob = useAppSelector(state => state.worker.job_detail);
  const user = useAppSelector(selectUserSelfDetails);
  const { data: currentData } = useWorkerQuery(null, { pollingInterval: 2000 });

  useEffect(() => {
    if (workerRunningJob !== undefined && currentData?.job_detail === null) {
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
      dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    } else {
      dispatch({ type: "SET_WORKER_AVAILABILITY", payload: true });
    }
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: currentData?.job_detail,
    });
  }, [currentData, dispatch, t, user.id, user.username, workerRunningJob]);

  return { workerRunningJob, currentData };
}
