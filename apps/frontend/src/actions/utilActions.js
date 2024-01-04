import { api } from "../api_client/api";
import { Server } from "../api_client/apiClient";
import { notification } from "../service/notifications";
import { UserSchema } from "../store/user/user.zod";
import { userActions } from "../store/user/userSlice";
import {
  CountStats,
  DeleteMissingPhotosResponse,
  GenerateEventAlbumsTitlesResponse,
  LocationSunburst,
  PhotoMonthCount,
  WordCloudResponse,
} from "./utilActions.types";

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

export function fetchLocationSunburst() {
  return function cb(dispatch) {
    dispatch({ type: "FETCH_LOCATION_SUNBURST" });
    Server.get(`locationsunburst/`)
      .then(response => {
        const data = LocationSunburst.parse(response.data);
        dispatch({
          type: "FETCH_LOCATION_SUNBURST_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_LOCATION_SUNBURST_REJECTED", payload: err });
      });
  };
}

export function fetchTimezoneList(dispatch) {
  dispatch({ type: "FETCH_TIMEZONE_LIST" });
  Server.get(`timezones/`)
    .then(response => {
      dispatch({
        type: "FETCH_TIMEZONE_LIST_FULFILLED",
        payload: response.data,
      });
    })
    .catch(err => {
      dispatch({ type: "FETCH_TIMEZONE_LIST_REJECTED", payload: err });
    });
}

export function fetchCountStats() {
  return function cb(dispatch) {
    dispatch({ type: "FETCH_COUNT_STATS" });
    Server.get(`stats/`)
      .then(response => {
        const data = CountStats.parse(response.data);
        dispatch({
          type: "FETCH_COUNT_STATS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_COUNT_STATS_REJECTED", payload: err });
      });
  };
}

export function fetchPhotoMonthCounts(dispatch) {
  dispatch({ type: "FETCH_PHOTO_MONTH_COUNTS" });
  Server.get(`photomonthcounts/`)
    .then(response => {
      const data = PhotoMonthCount.array().parse(response.data);
      dispatch({
        type: "FETCH_PHOTO_MONTH_COUNTS_FULFILLED",
        payload: data,
      });
    })
    .catch(err => {
      dispatch({ type: "FETCH_PHOTO_MONTH_COUNTS_REJECTED", payload: err });
    });
}

export function fetchWordCloud(dispatch) {
  dispatch({ type: "FETCH_WORDCLOUD" });
  Server.get(`wordcloud/`)
    .then(response => {
      const data = WordCloudResponse.parse(response.data);
      dispatch({ type: "FETCH_WORDCLOUD_FULFILLED", payload: data });
    })
    .catch(err => {
      dispatch({ type: "FETCH_WORDCLOUD_REJECTED", payload: err });
    });
}
