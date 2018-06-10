import axios from "axios";
import {Server} from '../api_client/apiClient'
import {fetchAutoAlbums} from './albumsActions'
import {notify} from 'reapop'


export function fetchWorkerAvailability(prevRunningJob) {
  return function(dispatch) {
    dispatch({type:"FETCH_WORKER_AVAILABILITY"})
    Server.get('rqavailable/')
    .then((response)=>{
      if (prevRunningJob!==null && response.data.job_detail===null){
        dispatch(notify({
          message:prevRunningJob.job_type_str+' finished.',
          title:prevRunningJob.job_type_str,
          status:'success',
          dismissible: true,
          dismissAfter:3000,
          position:'br'}))
        }
        
        if (response.data.queue_can_accept_job){
          dispatch({type:"SET_WORKER_AVAILABILITY",payload:true})
        } else {
          dispatch({type:"SET_WORKER_AVAILABILITY",payload:false})
        }
        dispatch({type:"SET_WORKER_RUNNING_JOB",payload:response.data.job_detail})
        console.log(prevRunningJob)
        console.log(response.data.job_detail)


      })
      .catch((error)=>{
        dispatch({type:"SET_WORKER_AVAILABILITY",payload:false})
      })
  }
}


export function generateEventAlbums() {
  return function(dispatch) {
    dispatch({type: "GENERATE_EVENT_ALBUMS"});
    dispatch({type:"SET_WORKER_AVAILABILITY",payload:false})
    dispatch({type:"SET_WORKER_RUNNING_JOB",payload:{job_type_str:'Generate Event Albums'}})
    Server.get(`autoalbumgen/`)
      .then((response) => {
        dispatch(notify({
          message:'Generate Event Albums started',
          title:'Generate Event Albums',
          status:'success',
          dismissible: true,
          dismissAfter:3000,
          position:'br'
        }))
        dispatch({type: "GENERATE_EVENT_ALBUMS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "GENERATE_EVENT_ALBUMS_REJECTED", payload: err}) })
  }
}



export function generateEventAlbumTitles() {
	return function(dispatch) {
    dispatch({type: "GENERATE_EVENT_ALBUMS_TITLES"})
    dispatch({type:"SET_WORKER_AVAILABILITY",payload:false})
    dispatch({type:"SET_WORKER_RUNNING_JOB",payload:{job_type_str:'Regenerate Event Titles'}})

    Server.get("autoalbumtitlegen/")
      .then((response) => {
        dispatch(notify({
          message:'Regenerate Event Titles started',
          title:'Regenerate Event Titles',
          status:'success',
          dismissible: true,
          dismissAfter:3000,
          position:'br'
        }))
        dispatch({type: "GENERATE_EVENT_ALBUMS_TITLES_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "GENERATE_EVENT_ALBUMS_TITLES_REJECTED", payload: err})
      })
	}
}




export function fetchExampleSearchTerms() {
  return function(dispatch) {
    dispatch({type: "FETCH_EXAMPLE_SEARCH_TERMS"});
    Server.get(`searchtermexamples/`)
      .then((response) => {
        dispatch({type: "FETCH_EXAMPLE_SEARCH_TERMS_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_EXAMPLE_SEARCH_TERMS_REJECTED", payload: err}) })
  }
}

export function fetchLocationSunburst() {
  return function(dispatch) {
    dispatch({type: "FETCH_LOCATION_SUNBURST"});
    Server.get(`locationsunburst/`)
      .then((response) => {
        dispatch({type: "FETCH_LOCATION_SUNBURST_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_LOCATION_SUNBURST_REJECTED", payload: err}) })
  }
}


export function fetchLocationTimeline() {
  return function(dispatch) {
    dispatch({type: "FETCH_LOCATION_TIMELINE"});
    Server.get(`locationtimeline/`)
      .then((response) => {
        dispatch({type: "FETCH_LOCATION_TIMELINE_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_LOCATION_TIMELINE_REJECTED", payload: err}) })
  }
}




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
