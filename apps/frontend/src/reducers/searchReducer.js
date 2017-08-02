export default function reducer(state={
    searchPhotosRes: [],
    searchingPhotos: false,
    searchedPhotos: false,
    error: null,
  }, action) {

  switch (action.type) {
  	case "SEARCH_PHOTOS": {
  		return {...state, searchingPhotos: true}
  	}

    case "SEARCH_PHOTOS_REJECTED": {
      return { ...state, searchingPhotos: false, error: action.payload}
    }

    case "SEARCH_PHOTOS_FULFILLED": {
      return {
        ...state,
        searchingPhotos: false,
        searchedPhotos: true,
        searchPhotosRes: action.payload
      }
    }

    default: {
      return {...state}
    }
  }
}
