import { showNotification } from "@mantine/notifications";

import { api } from "../api_client/api";
import { Server } from "../api_client/apiClient";
import i18n from "../i18n";
import { ManageUser, UserSchema } from "../store/user/user.zod";
import { userActions } from "../store/user/userSlice";
import { scanPhotos } from "./photosActions";
import {
  CountStats,
  DeleteMissingPhotosResponse,
  DirTree,
  GenerateEventAlbumsResponse,
  GenerateEventAlbumsTitlesResponse,
  LocationSunburst,
  LocationTimeline,
  PhotoMonthCount,
  SearchTermExamples,
  WordCloudResponse,
} from "./utilActions.types";

export function fetchDirectoryTree(path) {
  return function (dispatch) {
    dispatch({ type: "FETCH_DIRECTORY_TREE" });
    Server.get(`dirtree/?path=${path}`)
      .then(response => {
        const data = DirTree.array().parse(response.data);
        dispatch({
          type: "FETCH_DIRECTORY_TREE_FULFILLED",
          payload: data,
        });
      })
      .catch(error => {
        console.error(error);
        dispatch({ type: "FETCH_DIRECTORY_TREE_REJECTED", payload: error });
      });
  };
}

export function fetchNextcloudDirectoryTree(path) {
  return function (dispatch) {
    dispatch({ type: "FETCH_NEXTCLOUD_DIRECTORY_TREE" });
    Server.get(`nextcloud/listdir/?fpath=${path}`)
      .then(response => {
        // To-Do: Needs to be tested...
        // const data = DirTree.array().parse(response.data);
        dispatch({
          type: "FETCH_NEXTCLOUD_DIRECTORY_TREE_FULFILLED",
          payload: response.data,
        });
      })
      .catch(error => {
        console.error(error);
        dispatch({
          type: "FETCH_NEXTCLOUD_DIRECTORY_TREE_REJECTED",
          payload: error,
        });
      });
  };
}

export function updateAvatar(user, form_data) {
  return function (dispatch) {
    Server.patch(`user/${user.id}/`, form_data)
      .then(response => {
        const data = UserSchema.parse(response.data);
        dispatch(userActions.updateRules(data));
        dispatch(api.endpoints.fetchUserList.initiate()).refetch();
        dispatch(fetchNextcloudDirectoryTree("/"));
        showNotification({
          message: i18n.t("toasts.updateuser", { username: user.username }),
          title: i18n.t("toasts.updateusertitle"),
          color: "teal",
        });

        dispatch(api.endpoints.fetchUserSelfDetails.initiate(user.id)).refetch();
      })
      .catch(error => {
        console.error(error);
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
      showNotification({
        message: i18n.t("toasts.updateuser", { username: user.username }),
        title: i18n.t("toasts.updateusertitle"),
        color: "teal",
      });
      dispatch(fetchNextcloudDirectoryTree("/"));
    })
    .catch(error => {
      console.error(error);
      dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
    });
}

export function updateUserAndScan(user) {
  return function (dispatch) {
    Server.patch(`manage/user/${user.id}/`, user)
      .then(response => {
        ManageUser.parse(response.data);
        dispatch(userActions.updateRules(response.data));
        dispatch(api.endpoints.fetchUserList.initiate()).refetch();
        showNotification({
          message: i18n.t("toasts.updateuser", { username: user.username }),
          title: i18n.t("toasts.updateusertitle"),
          color: "teal",
        });

        dispatch(api.endpoints.fetchUserSelfDetails.initiate(user.id)).refetch();
        if (user.scan_directory) {
          dispatch(scanPhotos());
        }
      })
      .catch(error => {
        console.error(error);
        dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
      });
  };
}

export function deleteMissingPhotos() {
  return function (dispatch) {
    dispatch({ type: "DELETE_MISSING_PHOTOS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Delete Missing Photos" },
    });
    Server.get(`deletemissingphotos`)
      .then(response => {
        const data = DeleteMissingPhotosResponse.parse(response.data);
        showNotification({
          message: i18n.t("toasts.deletemissingphotos"),
          title: i18n.t("toasts.deletemissingphotostitle"),
          color: "teal",
        });

        dispatch({
          type: "DELETE_MISSING_PHOTOS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: "DELETE_MISSING_PHOTOS_REJECTED", payload: err });
      });
  };
}

export function generateEventAlbums() {
  return function (dispatch) {
    dispatch({ type: "GENERATE_EVENT_ALBUMS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Generate Event Albums" },
    });
    Server.get(`autoalbumgen/`)
      .then(response => {
        const data = GenerateEventAlbumsResponse.parse(response.data);
        showNotification({
          message: i18n.t("toasts.generateeventalbums"),
          title: i18n.t("toasts.generateeventalbumstitle"),
          color: "teal",
        });

        dispatch({
          type: "GENERATE_EVENT_ALBUMS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: "GENERATE_EVENT_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function generateEventAlbumTitles() {
  return function (dispatch) {
    dispatch({ type: "GENERATE_EVENT_ALBUMS_TITLES" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Regenerate Event Titles" },
    });

    Server.get("autoalbumtitlegen/")
      .then(response => {
        const data = GenerateEventAlbumsTitlesResponse.parse(response.data);
        showNotification({
          message: i18n.t("toasts.regenerateevents"),
          title: i18n.t("toasts.regenerateeventstitle"),
          color: "teal",
        });

        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_REJECTED",
          payload: err,
        });
      });
  };
}

export function fetchExampleSearchTerms() {
  return function (dispatch) {
    dispatch({ type: "FETCH_EXAMPLE_SEARCH_TERMS" });
    Server.get(`searchtermexamples/`)
      .then(response => {
        const data = SearchTermExamples.parse(response.data.results);
        dispatch({
          type: "FETCH_EXAMPLE_SEARCH_TERMS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: "FETCH_EXAMPLE_SEARCH_TERMS_REJECTED", payload: err });
      });
  };
}

export function fetchLocationSunburst() {
  return function (dispatch) {
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
        console.error(err);
        dispatch({ type: "FETCH_LOCATION_SUNBURST_REJECTED", payload: err });
      });
  };
}

export function fetchLocationTimeline(dispatch) {
  dispatch({ type: "FETCH_LOCATION_TIMELINE" });
  Server.get(`locationtimeline/`)
    .then(response => {
      const data = LocationTimeline.parse(response.data);
      dispatch({
        type: "FETCH_LOCATION_TIMELINE_FULFILLED",
        payload: data,
      });
    })
    .catch(err => {
      console.error(err);
      dispatch({ type: "FETCH_LOCATION_TIMELINE_REJECTED", payload: err });
    });
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
      console.log(err);
      dispatch({ type: "FETCH_TIMEZONE_LIST_REJECTED", payload: err });
    });
}

export function fetchCountStats() {
  return function (dispatch) {
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
        console.error(err);
        dispatch({ type: "FETCH_COUNT_STATS_REJECTED", payload: err });
      });
  };
}

export function fetchLocationClusters() {
  return function (dispatch) {
    dispatch({ type: "FETCH_LOCATION_CLUSTERS" });
    Server.get(`locclust/`)
      .then(response => {
        // To-Do: Weird response from server
        // const data = LocationCluster.array().parse(response.data);
        dispatch({
          type: "FETCH_LOCATION_CLUSTERS_FULFILLED",
          payload: response.data,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_LOCATION_CLUSTERS_REJECTED", payload: err });
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
      console.error(err);
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
      console.error(err);
      dispatch({ type: "FETCH_WORDCLOUD_REJECTED", payload: err });
    });
}
