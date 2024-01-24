import { DEFAULT_ACTION } from "./common";

const initialState = {
  siteSettings: {
    allow_registration: false,
    allow_upload: false,
    skip_patterns: "",
    heavyweight_process: 1,
    map_api_key: "",
  },
  fetchingSiteSettings: false,
  fetchedSiteSettings: false,

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

  locationTimeline: [],
  fetchingLocationTimeline: false,
  fetchedLocationTimeline: false,

  workerAvailability: false,
  workerRunningJob: null,

  userList: [],
  fetchingUserList: false,
  fetchedUserList: false,

  directoryTree: [],
  fetchingDirectoryTree: false,
  fetchedDirectoryTree: false,

  nextcloudDirectoryTree: [],
  fetchingNextcloudDirectoryTree: false,
  fetchedNextcloudDirectoryTree: false,

  jobList: [],
  jobCount: 0,
  fetchingJobList: false,
  fetchedJobList: false,

  error: null,
};

export default function reducer(state = initialState, action = DEFAULT_ACTION) {
  switch (action.type) {
    case "FETCH_JOB_LIST": {
      return {
        ...state,
        fetchingJobList: true,
      };
    }
    case "FETCH_JOB_LIST_FULFILLED": {
      return {
        ...state,
        jobList: action.payload.results,
        jobCount: action.payload.count,
        fetchedJobList: true,
        fetchingJobList: false,
      };
    }
    case "FETCH_JOB_LIST_REJECTED": {
      return {
        ...state,
        fetchingJobList: false,
        fetchedJobList: false,
      };
    }

    case "SET_SITE_SETTINGS_FULFILLED": {
      return {
        ...state,
        siteSettings: action.payload,
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
        siteSettings: action.payload,
      };
    }
    case "FETCH_SITE_SETTINGS_REJECTED": {
      return {
        ...state,
        fetchingSiteSettings: false,
      };
    }

    case "FETCH_USER_LIST": {
      return { ...state, fetchingUserList: true };
    }
    case "FETCH_USER_LIST_FULFILLED": {
      return {
        ...state,
        fetchingUserList: false,
        fetchedUserList: true,
        userList: action.payload,
      };
    }
    case "FETCH_USER_LIST_REJECTED": {
      return {
        ...state,
        fetchingUserList: false,
      };
    }

    case "FETCH_DIRECTORY_TREE": {
      return { ...state, fetchingDirectoryTree: true };
    }
    case "FETCH_DIRECTORY_TREE_FULFILLED": {
      return {
        ...state,
        fetchingDirectoryTree: false,
        fetchedDirectoryTree: true,
        directoryTree: action.payload,
      };
    }
    case "FETCH_DIRECTORY_TREE_REJECTED": {
      return {
        ...state,
        fetchingDirectoryTree: false,
      };
    }

    case "FETCH_NEXTCLOUD_DIRECTORY_TREE": {
      return { ...state, fetchingNextcloudDirectoryTree: true };
    }
    case "FETCH_NEXTCLOUD_DIRECTORY_TREE_FULFILLED": {
      return {
        ...state,
        fetchingNextcloudDirectoryTree: false,
        fetchedNextcloudDirectoryTree: true,
        nextcloudDirectoryTree: action.payload,
      };
    }
    case "FETCH_NEXTCLOUD_DIRECTORY_TREE_REJECTED": {
      return {
        ...state,
        fetchingNextcloudDirectoryTree: false,
        fetchedNextcloudDirectoryTree: false,
      };
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
        deleteMissingPhotos: false,
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
        generatingAutoAlbums: false,
      };
    }

    case "FETCH_LOCATION_TIMELINE": {
      return { ...state, fetchingLocationTimeline: true };
    }
    case "FETCH_LOCATION_TIMELINE_REJECTED": {
      return {
        ...state,
        fetchingLocationTimeline: false,
        error: action.payload,
      };
    }
    case "FETCH_LOCATION_TIMELINE_FULFILLED": {
      return {
        ...state,
        fetchingLocationTimeline: false,
        fetchedLocationTimeline: true,
        locationTimeline: action.payload,
      };
    }

    case "FETCH_EXAMPLE_SEARCH_TERMS": {
      return { ...state, fetchingExampleSearchTerms: true };
    }
    case "FETCH_EXAMPLE_SEARCH_TERMS_REJECTED": {
      return {
        ...state,
        fetchingExampleSearchTerms: false,
        error: action.payload,
      };
    }
    case "FETCH_EXAMPLE_SEARCH_TERMS_FULFILLED": {
      return {
        ...state,
        fetchingExampleSearchTerms: false,
        fetchedExampleSearchTerms: true,
        exampleSearchTerms: action.payload,
      };
    }

    case "FETCH_LOCATION_CLUSTERS": {
      return { ...state, fetchingLocationClusters: true };
    }
    case "FETCH_LOCATION_CLUSTERS_REJECTED": {
      return {
        ...state,
        fetchingLocationClusters: false,
        error: action.payload,
      };
    }
    case "FETCH_LOCATION_CLUSTERS_FULFILLED": {
      return {
        ...state,
        fetchingLocationClusters: false,
        fetchedLocationClusters: true,
        locationClusters: action.payload,
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
        wordCloud: action.payload,
      };
    }

    case "FETCH_PHOTO_SCAN_STATUS": {
      return { ...state, fetchingPhotoScanStatus: true };
    }
    case "FETCH_PHOTO_SCAN_STATUS_REJECTED": {
      return {
        ...state,
        fetchingPhotoScanStatus: false,
        error: action.payload,
      };
    }
    case "FETCH_PHOTO_SCAN_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingPhotoScanStatus: false,
        fetchedPhotoScanStatus: true,
        statusPhotoScan: action.payload,
      };
    }

    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS": {
      return { ...state, fetchingAutoAlbumProcessingStatus: true };
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_REJECTED": {
      return {
        ...state,
        fetchingAutoAlbumProcessingStatus: false,
        error: action.payload,
      };
    }
    case "FETCH_AUTO_ALBUM_PROCESSING_STATUS_FULFILLED": {
      return {
        ...state,
        fetchingAutoAlbumProcessingStatus: false,
        fetchedAutoAlbumProcessingStatus: true,
        statusAutoAlbumProcessing: action.payload,
      };
    }

    case "auth/logout":
      return { ...initialState };

    default: {
      return { ...state };
    }
  }
}
