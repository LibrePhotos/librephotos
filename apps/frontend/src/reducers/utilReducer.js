export default function reducer(
  state = {

    siteSettings: {},
    fetchingSiteSettings: false,
    fetchedSiteSettings: false,

    countStats: {},
    fetchingCountStats: false,
    fetchedCountStats: false,

    photoCountryCounts: {},
    fetchingPhotoCountryCounts: false,
    fetchedPhotoCountryCounts: false,

    photoMonthCounts: [],
    fetchingPhotoMonthCounts: false,
    fetchedPhotoMonthCounts: false,

    statusPhotoScan: { status: true },
    statusAutoAlbumProcessing: { status: true },

    generatingAutoAlbums: false,

    deleteMissingPhotos: false,

    locationClusters: [],
    fetchingLocationClusters: false,
    fetchedLocationClusters: false,

    wordCloud: {},
    fetchingWordCloud: false,
    fetchedWordCloud: false,

    exampleSearchTerms: [],
    fetchingExampleSearchTerms: false,
    fetchedExampleSearchTerms: false,

    locationSunburst: { name: "Loading..." },
    fetchingLocationSunburst: false,
    fetchedLocationSunburst: false,

    locationTimeline: [],
    fetchingLocationTimeline: false,
    fetchedLocationTimeline: false,

    workerAvailability: false,
    workerRunningJob: null,

    userList: [],
    fetchingUserList: false,
    fetchedUserList: false,

    directoryTree:[],
    fetchingDirectoryTree:false,
    fetchedDirectoryTree:false,

    nextcloudDirectoryTree:[],
    fetchingNextcloudDirectoryTree:false,
    fetchedNextcloudDirectoryTree:false,

    jobList: [],
    jobCount: 0,
    fetchingJobList: false,
    fetchedJobList: false,

    error: null
  },
  action
) {
  switch (action.type) {

    case "FETCH_JOB_LIST": {
      return {
        ...state,
        fetchingJobList: true
      };
    }
    case "FETCH_JOB_LIST_FULFILLED": {
      return {
        ...state,
        jobList: action.payload.results,
        jobCount: action.payload.count,
        fetchedJobList: true,
        fetchingJobList: false
      }
    }
    case "FETCH_JOB_LIST_REJECTED": {
      return {
        ...state,
        fetchingJobList: false,
        fetchedJobList: false
      };
    }






    case "SET_SITE_SETTINGS_FULFILLED": {
      return {
        ...state,
        siteSettings: action.payload
      };
    }



    case "FETCH_SITE_SETTINGS": {
      return { ...state, fetchingSiteSettings: true };
    }
    case "FETCH_SITE_SETTINGS_FULFILLED": {
      return {
        ...state,
        fetchingSiteSettings: false,
        fetchedSiteSettings: true,
        siteSettings: action.payload
      };
    }
    case "FETCH_SITE_SETTINGS_REJECTED": {
      return {
        ...state,
        fetchingSiteSettings:false,
      }
    }



    case "FETCH_USER_LIST": {
      return { ...state, fetchingUserList: true };
    }
    case "FETCH_USER_LIST_FULFILLED": {
      return {
        ...state,
        fetchingUserList: false,
        fetchedUserList: true,
        userList: action.payload
      };
    }
    case "FETCH_USER_LIST_REJECTED": {
      return {
        ...state,
        fetchingUserList:false,
      }
    }

    case "FETCH_DIRECTORY_TREE": {
      return { ...state, fetchingDirectoryTree: true };
    }
    case "FETCH_DIRECTORY_TREE_FULFILLED": {
      return {
        ...state,
        fetchingDirectoryTree: false,
        fetchedDirectoryTree: true,
        directoryTree: action.payload
      };
    }
    case "FETCH_DIRECTORY_TREE_REJECTED": {
      return {
        ...state,
        fetchingDirectoryTree:false,
      }
    }
                                          
    case "FETCH_NEXTCLOUD_DIRECTORY_TREE": {
      return { ...state, fetchingNextcloudDirectoryTree: true };
    }
    case "FETCH_NEXTCLOUD_DIRECTORY_TREE_FULFILLED": {
      return {
        ...state,
        fetchingNextcloudDirectoryTree: false,
        fetchedNextcloudDirectoryTree: true,
        nextcloudDirectoryTree: action.payload
      };
    }
    case "FETCH_NEXTCLOUD_DIRECTORY_TREE_REJECTED": {
      return {
        ...state,
        fetchingNextcloudDirectoryTree:false,
        fetchedNextcloudDirectoryTree: false,
      }
    }

    case "SET_WORKER_AVAILABILITY": {
      return { ...state, workerAvailability: action.payload };
    }
    case "SET_WORKER_RUNNING_JOB": {
      return { ...state, workerRunningJob: action.payload };
    }

    case "DELETE_MISSING_PHOTOS": {
      return { ...state, deleteMissingPhotos: true };
    }
    case "DELETE_MISSING_PHOTOS_REJECTED": {
      return { ...state, deleteMissingPhotos: false, error: action.payload };
    }
    case "DELETE_MISSING_PHOTOS_FULFILLED": {
      return {
        ...state,
        deleteMissingPhotos: false
      };
    }

    case "GENERATE_EVENT_ALBUMS": {
      return { ...state, generatingAutoAlbums: true };
    }
    case "GENERATE_EVENT_ALBUMS_REJECTED": {
      return { ...state, generatingAutoAlbums: false, error: action.payload };
    }
    case "GENERATE_EVENT_ALBUMS_FULFILLED": {
      return {
        ...state,
        generatingAutoAlbums: false
      };
    }

    case "FETCH_LOCATION_TIMELINE": {
      return { ...state, fetchingLocationTimeline: true };
    }
    case "FETCH_LOCATION_TIMELINE_REJECTED": {
      return {
        ...state,
        fetchingLocationTimeline: false,
        error: action.payload
      };
    }
    case "FETCH_LOCATION_TIMELINE_FULFILLED": {
      return {
        ...state,
        fetchingLocationTimeline: false,
        fetchedLocationTimeline: true,
        locationTimeline: action.payload
      };
    }

    case "FETCH_LOCATION_SUNBURST": {
      return { ...state, fetchingLocationSunburst: true };
    }
    case "FETCH_LOCATION_SUNBURST_REJECTED": {
      return {
        ...state,
        fetchingLocationSunburst: false,
        error: action.payload
      };
    }
    case "FETCH_LOCATION_SUNBURST_FULFILLED": {
      return {
        ...state,
        fetchingLocationSunburst: false,
        fetchedLocationSunburst: true,
        locationSunburst: action.payload
      };
    }

    case "FETCH_EXAMPLE_SEARCH_TERMS": {
      return { ...state, fetchingExampleSearchTerms: true };
    }
    case "FETCH_EXAMPLE_SEARCH_TERMS_REJECTED": {
      return {
        ...state,
        fetchingExampleSearchTerms: false,
        error: action.payload
      };
    }
    case "FETCH_EXAMPLE_SEARCH_TERMS_FULFILLED": {
      return {
        ...state,
        fetchingExampleSearchTerms: false,
        fetchedExampleSearchTerms: true,
        exampleSearchTerms: action.payload
      };
    }

    case "FETCH_COUNT_STATS": {
      return { ...state, fetchingCountStats: true };
    }
    case "FETCH_COUNT_STATS_REJECTED": {
      return { ...state, fetchingCountStats: false, error: action.payload };
    }
    case "FETCH_COUNT_STATS_FULFILLED": {
      return {
        ...state,
        fetchingCountStats: false,
        fetchedCountStats: true,
        countStats: action.payload
      };
    }

    case "FETCH_LOCATION_CLUSTERS": {
      return { ...state, fetchingLocationClusters: true };
    }
    case "FETCH_LOCATION_CLUSTERS_REJECTED": {
      return {
        ...state,
        fetchingLocationClusters: false,
        error: action.payload
      };
    }
    case "FETCH_LOCATION_CLUSTERS_FULFILLED": {
      return {
        ...state,
        fetchingLocationClusters: false,
        fetchedLocationClusters: true,
        locationClusters: action.payload
      };
    }

    case "FETCH_PHOTO_COUNTRY_COUNTS": {
      return { ...state, fetchingPhotoCountryCounts: true };
    }
    case "FETCH_PHOTO_COUNTRY_COUNTS_REJECTED": {
      return {
        ...state,
        fetchingPhotoCountryCounts: false,
        error: action.payload
      };
    }
    case "FETCH_PHOTO_COUNTRY_COUNTS_FULFILLED": {
      return {
        ...state,
        fetchingPhotoCountryCounts: false,
        fetchedPhotoCountryCounts: true,
        photoCountryCounts: action.payload
      };
    }

    case "FETCH_PHOTO_MONTH_COUNTS": {
      return { ...state, fetchingPhotoMonthCounts: true };
    }
    case "FETCH_PHOTO_MONTH_COUNTS_REJECTED": {
      return {
        ...state,
        fetchingPhotoMonthCounts: false,
        error: action.payload
      };
    }
    case "FETCH_PHOTO_MONTH_COUNTS_FULFILLED": {
      return {
        ...state,
        fetchingPhotoMonthCounts: false,
        fetchedPhotoMonthCounts: true,
        photoMonthCounts: action.payload
      };
    }

    case "FETCH_WORDCLOUD": {
      return { ...state, fetchingWordCloud: true };
    }
    case "FETCH_WORDCLOUD_REJECTED": {
      return { ...state, fetchingWordCloud: false, error: action.payload };
    }
    case "FETCH_WORDCLOUD_FULFILLED": {
      return {
        ...state,
        fetchingWordCloud: false,
        fetchedWordCloud: true,
        wordCloud: action.payload
      };
    }

    case "FETCH_PHOTO_SCAN_STATUS": {
      return { ...state, fetchingPhotoScanStatus: true };
    }
    case "FETCH_PHOTO_SCAN_STATUS_REJECTED": {
      return {
        ...state,
        fetchingPhotoScanStatus: false,
        error: action.payload
      };
    }
    case "FETCH_PHOTO_SCAN_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingPhotoScanStatus: false,
        fetchedPhotoScanStatus: true,
        statusPhotoScan: action.payload
      };
    }

    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS": {
      return { ...state, fetchingAutoAlbumProcessingStatus: true };
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_REJECTED": {
      return {
        ...state,
        fetchingAutoAlbumProcessingStatus: false,
        error: action.payload
      };
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingAutoAlbumProcessingStatus: false,
        fetchedAutoAlbumProcessingStatus: true,
        statusAutoAlbumProcessing: action.payload
      };
    }

    default: {
      return { ...state };
    }
  }
}

// FETCH_LOCATION_CLUSTERS
// FETCH_LOCATION_CLUSTERS_REJECTED
// FETCH_LOCATION_CLUSTERS_FULFILLED
