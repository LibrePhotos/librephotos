import { notify } from "reapop";
import { Server } from "../api_client/apiClient";
import { logout } from "../actions/authActions";
import { fetchDateAlbumsPhotoHashList } from "./albumsActions";
import { fetchInferredFacesList, fetchLabeledFacesList } from "./facesActions";
import { fetchUserSelfDetails} from './userActions' ;
import { fetchPeople } from "./peopleActions";


export function fetchJobList(page,page_size=10) {
  return function(dispatch) {
    dispatch({ type: "FETCH_JOB_LIST" })
    Server.get(`jobs/?page_size=${page_size}&page=${page}`)
      .then(response=>{
        dispatch({ type: 'FETCH_JOB_LIST_FULFILLED', payload: response.data })
      })
      .catch(error=>{
        dispatch({ type: 'FETCH_JOB_LIST_REJECTED', payload: error})
      })
  }
}

export function deleteJob(job_id,page=1,page_size=10) {
  return function(dispatch) {
    dispatch({ type: "DELETE_JOB" })
    Server.delete(`jobs/${job_id}`)
      .then(response=>{
        dispatch(fetchJobList(page,page_size))
        dispatch({ type: 'DELETE_JOB_FULFILLED', payload: response.data })
      })
      .catch(error=>{
        dispatch({ type: 'DELETE_JOB_REJECTED', payload: error})
      })
  }
}


export function setSiteSettings(siteSettings) {
  return function(dispatch) {
    dispatch({ type: "SET_SITE_SETTINGS" });
    Server.post("sitesettings/",siteSettings)
      .then(response => {
        dispatch({
          type: "SET_SITE_SETTINGS_FULFILLED",
          payload: response.data
        });
      })
      .catch(error => {
        dispatch({ type: "SET_SITE_SETTINGS_REJECTED", payload: error });
      });
  };
}


export function fetchSiteSettings() {
  return function(dispatch) {
    dispatch({ type: "FETCH_SITE_SETTINGS" });
    Server.get("sitesettings/")
      .then(response => {
        dispatch({
          type: "FETCH_SITE_SETTINGS_FULFILLED",
          payload: response.data
        });
      })
      .catch(error => {
        dispatch({ type: "FETCH_SITE_SETTINGS_REJECTED", payload: error });
      });
  };
}


// Todo: put this under userActions.js
export function fetchUserList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_LIST" });
    Server.get("user/")
      .then(response => {
        dispatch({
          type: "FETCH_USER_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(error => {
        dispatch({ type: "FETCH_USER_LIST_REJECTED", payload: error });
      });
  };
}

export function fetchDirectoryTree() {
  return function(dispatch) {
    dispatch({ type: "FETCH_DIRECTORY_TREE" });
    Server.get("dirtree/")
      .then(response => {
        dispatch({
          type: "FETCH_DIRECTORY_TREE_FULFILLED",
          payload: response.data
        });
      })
      .catch(error => {
        dispatch({ type: "FETCH_DIRECTORY_TREE_REJECTED", payload: error });
      });
  };
}


export function fetchNextcloudDirectoryTree(path) {
  return function(dispatch) {
    dispatch({ type: "FETCH_NEXTCLOUD_DIRECTORY_TREE" });
    Server.get(`nextcloud/listdir/?path=${path}`)
      .then(response => {
        dispatch({
          type: "FETCH_NEXTCLOUD_DIRECTORY_TREE_FULFILLED",
          payload: response.data
        });
      })
      .catch(error => {
        dispatch({ type: "FETCH_NEXTCLOUD_DIRECTORY_TREE_REJECTED", payload: error });
      });
  };
}

export function updateAvatar(user, form_data){
  return function(dispatch) {
    dispatch({ type: "UPDATE_USER" });
    Server.patch(`user/${user.id}/`, form_data)
      .then(response => {
        dispatch({
          type: "UPDATE_USER_FULFILLED",
          payload: response.data
        });
        dispatch(fetchUserList())
        dispatch(fetchNextcloudDirectoryTree('/'))
        dispatch(
          notify({
            message: `${user.username}'s information was successfully updated`,
            title: 'Update user',
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        )
        dispatch(fetchUserSelfDetails(user.id))
      })
      .catch(error => {
        dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
      });
  };
}

export function updateUser(user) {
  return function(dispatch) {
    dispatch({ type: "UPDATE_USER" });
    console.log(user)
    Server.patch(`user/${user.id}/`,user)
      .then(response => {
        dispatch({
          type: "UPDATE_USER_FULFILLED",
          payload: response.data
        });
        dispatch(fetchUserList())
        dispatch(fetchNextcloudDirectoryTree('/'))
        dispatch(
          notify({
            message: `${user.username}'s information was successfully updated`,
            title: 'Update user',
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        )
        dispatch(fetchUserSelfDetails(user.id))
      })
      .catch(error => {
        dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
      });
  };
}


export function manageUpdateUser(user) {
  return function(dispatch) {
    dispatch({ type: "UPDATE_USER" });
    console.log(user)

    Server.patch(`manage/user/${user.id}/`,user)
      .then(response => {
        dispatch({
          type: "UPDATE_USER_FULFILLED",
          payload: response.data
        });
        dispatch(fetchUserList())
        dispatch(
          notify({
            message: `${user.username}'s information was successfully updated`,
            title: 'Update user',
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        )
      })
      .catch(error => {
        dispatch({ type: "UPDATE_USER_REJECTED", payload: error });
      });
  };
}



export function fetchWorkerAvailability(prevRunningJob) {
  return function(dispatch) {
    dispatch({ type: "FETCH_WORKER_AVAILABILITY" });
    Server.get("rqavailable/")
      .then(response => {
        if (prevRunningJob !== null && response.data.job_detail === null) {
          dispatch(
            notify({
              message: prevRunningJob.job_type_str + " finished.",
              title: prevRunningJob.job_type_str,
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "br"
            })
          );
          if (prevRunningJob.job_type_str.toLowerCase() === "train faces") {
            dispatch(fetchLabeledFacesList());
            dispatch(fetchInferredFacesList());
            dispatch(fetchPeople())
          }
          if (prevRunningJob.job_type_str.toLowerCase() === "scan photos") {
            dispatch(fetchDateAlbumsPhotoHashList());
          }
        }

        if (response.data.job_detail) {
          dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
        } else {
          dispatch({ type: "SET_WORKER_AVAILABILITY", payload: true });
        }
        dispatch({
          type: "SET_WORKER_RUNNING_JOB",
          payload: response.data.job_detail
        });
      })
      .catch(error => {
        dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
        console.log(error.message)

        if (error.message.indexOf("502") !== -1) {
          // Backend is offline; HTTP error status code 502
          console.log("Backend is offline")
          dispatch(logout())
        }
      });
  };
}

export function generateEventAlbums() {
  return function(dispatch) {
    dispatch({ type: "GENERATE_EVENT_ALBUMS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Generate Event Albums" }
    });
    Server.get(`autoalbumgen/`)
      .then(response => {
        dispatch(
          notify({
            message: "Generate Event Albums started",
            title: "Generate Event Albums",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        );
        dispatch({
          type: "GENERATE_EVENT_ALBUMS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "GENERATE_EVENT_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function generateEventAlbumTitles() {
  return function(dispatch) {
    dispatch({ type: "GENERATE_EVENT_ALBUMS_TITLES" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Regenerate Event Titles" }
    });

    Server.get("autoalbumtitlegen/")
      .then(response => {
        dispatch(
          notify({
            message: "Regenerate Event Titles started",
            title: "Regenerate Event Titles",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        );
        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({
          type: "GENERATE_EVENT_ALBUMS_TITLES_REJECTED",
          payload: err
        });
      });
  };
}

export function fetchExampleSearchTerms() {
  return function(dispatch) {
    dispatch({ type: "FETCH_EXAMPLE_SEARCH_TERMS" });
    Server.get(`searchtermexamples/`)
      .then(response => {
        dispatch({
          type: "FETCH_EXAMPLE_SEARCH_TERMS_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_EXAMPLE_SEARCH_TERMS_REJECTED", payload: err });
      });
  };
}

export function fetchLocationSunburst() {
  return function(dispatch) {
    dispatch({ type: "FETCH_LOCATION_SUNBURST" });
    Server.get(`locationsunburst/`)
      .then(response => {
        dispatch({
          type: "FETCH_LOCATION_SUNBURST_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_LOCATION_SUNBURST_REJECTED", payload: err });
      });
  };
}

export function fetchLocationTimeline() {
  return function(dispatch) {
    dispatch({ type: "FETCH_LOCATION_TIMELINE" });
    Server.get(`locationtimeline/`)
      .then(response => {
        dispatch({
          type: "FETCH_LOCATION_TIMELINE_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_LOCATION_TIMELINE_REJECTED", payload: err });
      });
  };
}

export function fetchCountStats() {
  return function(dispatch) {
    dispatch({ type: "FETCH_COUNT_STATS" });
    Server.get(`stats/`)
      .then(response => {
        dispatch({
          type: "FETCH_COUNT_STATS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_COUNT_STATS_REJECTED", payload: err });
      });
  };
}

export function fetchPhotoScanStatus() {
  return function(dispatch) {
    dispatch({ type: "FETCH_PHOTO_SCAN_STATUS" });
    Server.get(`watcher/photo/`)
      .then(response => {
        dispatch({
          type: "FETCH_PHOTO_SCAN_STATUS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PHOTO_SCAN_STATUS_REJECTED", payload: err });
      });
  };
}

export function fetchAutoAlbumProcessingStatus() {
  return function(dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS" });
    Server.get(`watcher/autoalbum/`)
      .then(response => {
        dispatch({
          type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({
          type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS_REJECTED",
          payload: err
        });
      });
  };
}

export function fetchLocationClusters() {
  return function(dispatch) {
    dispatch({ type: "FETCH_LOCATION_CLUSTERS" });
    Server.get(`locclust/`)
      .then(response => {
        dispatch({
          type: "FETCH_LOCATION_CLUSTERS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_LOCATION_CLUSTERS_REJECTED", payload: err });
      });
  };
}

export function fetchPhotoCountryCounts() {
  return function(dispatch) {
    dispatch({ type: "FETCH_PHOTO_COUNTRY_COUNTS" });
    Server.get(`photocountrycounts/`)
      .then(response => {
        dispatch({
          type: "FETCH_PHOTO_COUNTRY_COUNTS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PHOTO_COUNTRY_COUNTS_REJECTED", payload: err });
      });
  };
}

export function fetchPhotoMonthCounts() {
  return function(dispatch) {
    dispatch({ type: "FETCH_PHOTO_MONTH_COUNTS" });
    Server.get(`photomonthcounts/`)
      .then(response => {
        dispatch({
          type: "FETCH_PHOTO_MONTH_COUNTS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PHOTO_MONTH_COUNTS_REJECTED", payload: err });
      });
  };
}

export function fetchWordCloud() {
  return function(dispatch) {
    dispatch({ type: "FETCH_WORDCLOUD" });
    Server.get(`wordcloud/`)
      .then(response => {
        dispatch({ type: "FETCH_WORDCLOUD_FULFILLED", payload: response.data });
      })
      .catch(err => {
        dispatch({ type: "FETCH_WORDCLOUD_REJECTED", payload: err });
      });
  };
}
