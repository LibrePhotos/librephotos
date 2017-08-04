import axios from "axios";
import {Server} from '../api_client/apiClient'

export function fetchCountStats() {
  return function(dispatch) {
    dispatch({type: "FETCH_COUNT_STATS"});
    Server.get(`stats/`)
      .then((response) => {
        dispatch({type: "FETCH_COUNT_STATS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_COUNT_STATS_REJECTED", payload: err})
      })
  }
}

export function fetchPhotoScanStatus() {
  return function(dispatch) {
    dispatch({type: "FETCH_PHOTO_SCAN_STATUS"});
    Server.get(`watcher/photo/`)
      .then((response) => {
        dispatch({type: "FETCH_PHOTO_SCAN_STATUS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PHOTO_SCAN_STATUS_REJECTED", payload: err})
      })
  }
}

export function fetchAutoAlbumProcessingStatus() {
  return function(dispatch) {
    dispatch({type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS"});
    Server.get(`watcher/autoalbum/`)
      .then((response) => {
        dispatch({type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUM_PROCESSING_STATUS_REJECTED", payload: err})
      })
  }
}

export function fetchLocationClusters() {
  return function(dispatch) {
    dispatch({type: "FETCH_LOCATION_CLUSTERS"});
    Server.get(`locclust/`)
      .then((response) => {
        dispatch({type: "FETCH_LOCATION_CLUSTERS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_LOCATION_CLUSTERS_REJECTED", payload: err})
      })
  }
}


export function fetchPhotoCountryCounts() {
  return function(dispatch) {
    dispatch({type: "FETCH_PHOTO_COUNTRY_COUNTS"});
    Server.get(`photocountrycounts/`)
      .then((response) => {
        dispatch({type: "FETCH_PHOTO_COUNTRY_COUNTS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PHOTO_COUNTRY_COUNTS_REJECTED", payload: err})
      })
  }
}


export function fetchPhotoMonthCounts() {
  return function(dispatch) {
    dispatch({type: "FETCH_PHOTO_MONTH_COUNTS"});
    Server.get(`photomonthcounts/`)
      .then((response) => {
        dispatch({type: "FETCH_PHOTO_MONTH_COUNTS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PHOTO_MONTH_COUNTS_REJECTED", payload: err})
      })
  }
}


export function fetchWordCloud() {
  return function(dispatch) {
    dispatch({type: "FETCH_WORDCLOUD"});
    Server.get(`wordcloud/`)
      .then((response) => {
        dispatch({type: "FETCH_WORDCLOUD_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_WORDCLOUD_REJECTED", payload: err})
      })
  }
}
