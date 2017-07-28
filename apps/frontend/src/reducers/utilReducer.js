export default function reducer(state={
    countStats: {},
    fetchingCountStats: false,
    fetchedCountStats: false,

    statusPhotoScan: {status:false},
    statusAutoAlbumProcessing: {status:false},

    locationClusters: [],
    fetchingLocationClusters:false,
    fetchedLocationClusters:false,

    error: null,
  }, action) {

  switch (action.type) {
    case "FETCH_COUNT_STATS": {
      return {...state, fetchingCountStats: true}
    }
    case "FETCH_COUNT_STATS_REJECTED": {
      return {...state, fetchingCountStats: false, error: action.payload}
    }
    case "FETCH_COUNT_STATS_FULFILLED": {
      return {
        ...state,
        fetchingCountStats: false,
        fetchedCountStats: true,
        countStats: action.payload
      }
    }


    case "FETCH_LOCATION_CLUSTERS": {
      return {...state, fetchingLocationClusters: true}
    }
    case "FETCH_LOCATION_CLUSTERS_REJECTED": {
      return {...state, fetchingLocationClusters: false, error: action.payload}
    }
    case "FETCH_LOCATION_CLUSTERS_FULFILLED": {
      return {
        ...state,
        fetchingLocationClusters: false,
        fetchedLocationClusters: true,
        locationClusters: action.payload
      }
    }





    case "FETCH_PHOTO_SCAN_STATUS": {
      return {...state, fetchingPhotoScanStatus: true}
    }
    case "FETCH_PHOTO_SCAN_STATUS_REJECTED": {
      return {...state, fetchingPhotoScanStatus: false, error: action.payload}
    }
    case "FETCH_PHOTO_SCAN_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingPhotoScanStatus: false,
        fetchedPhotoScanStatus: true,
        statusPhotoScan: action.payload
      }
    }

    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS": {
      return {...state, fetchingAutoAlbumProcessingStatus: true}
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_REJECTED": {
      return {...state, fetchingAutoAlbumProcessingStatus: false, error: action.payload}
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingAutoAlbumProcessingStatus: false,
        fetchedAutoAlbumProcessingStatus: true,
        statusAutoAlbumProcessing: action.payload
      }
    }

    default: {
      return {...state}
    }
  }
}



// FETCH_LOCATION_CLUSTERS
// FETCH_LOCATION_CLUSTERS_REJECTED
// FETCH_LOCATION_CLUSTERS_FULFILLED