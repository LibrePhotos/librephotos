import { api } from "../api_client/api";
import { Server } from "../api_client/apiClient";
import { notification } from "../service/notifications";
import { UserSchema } from "../store/user/user.zod";
import { userActions } from "../store/user/userSlice";
import { DeleteMissingPhotosResponse, GenerateEventAlbumsTitlesResponse } from "./utilActions.types";

export function updateAvatar(user, form_data) {
  return function cb(dispatch) {
    Server.patch(`user/${user.id}/`, form_data)
      .then(response => {
        const data = UserSchema.parse(response.data);
        dispatch(userActions.updateRules(data));
        dispatch(api.endpoints.fetchUserList.initiate()).refetch();
        dispatch(api.endpoints.fetchUserSelfDetails.initiate(user.id)).refetch();
        dispatch(api.endpoints.fetchNextcloudDirs.initiate()).refetch();
        notification.updateUser(user.username);
      })
      .catch(error => {
        dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
      });
  };
}

export function updateUser(user, dispatch) {
  Server.patch(`user/${user.id}/`, user)
    .then(response => {
      const data = UserSchema.parse(response.data);
      dispatch(api.endpoints.fetchUserSelfDetails.initiate(user.id)).refetch();
      dispatch(userActions.updateRules(data));
      dispatch(api.endpoints.fetchUserList.initiate()).refetch();
      dispatch(api.endpoints.fetchNextcloudDirs.initiate()).refetch();
      notification.updateUser(user.username);
    })
    .catch(error => {
      dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
    });
}

export function deleteMissingPhotos() {
  return function cb(dispatch) {
    dispatch({ type: "DELETE_MISSING_PHOTOS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Delete Missing Photos" },
    });
    Server.get(`deletemissingphotos`)
      .then(response => {
        const data = DeleteMissingPhotosResponse.parse(response.data);
        notification.deleteMissingPhotos();

        dispatch({
          type: "DELETE_MISSING_PHOTOS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        dispatch({ type: "DELETE_MISSING_PHOTOS_REJECTED", payload: err });
      });
  };
}

export function generateEventAlbumTitles() {
  return function cb(dispatch) {
    dispatch({ type: "GENERATE_EVENT_ALBUMS_TITLES" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Regenerate Event Titles" },
    });

    Server.get("autoalbumtitlegen/")
      .then(response => {
        const data = GenerateEventAlbumsTitlesResponse.parse(response.data);
        notification.regenerateEventAlbums();

        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_REJECTED",
          payload: err,
        });
      });
  };
}
