export default function reducer(state={
	scanningPhotos: false,
	scannedPhotos: false,
  error: null,

  photoDetails:{},
  fetchingPhotoDetail: false,
  fetchedPhotoDetail: false,

  photos: [],
  fetchedPhotos: false,
  fetchingPhotos: false,

  }, action) {

  switch (action.type) {
    case "SCAN_PHOTOS": {
      return {...state, scanningPhotos: true}
    }
    case "SCAN_PHOTOS_REJECTED": {
      return {...state, scanningPhotos: false, error: action.payload}
    }
    case "SCAN_PHOTOS_FULFILLED": {
      return {
        ...state,
        scanningPhotos: false,
        scannedPhotos: true,
      }
    }


    case "FETCH_PHOTOS": {
      return {...state, fetchingPhotos: true}
    }
    case "FETCH_PHOTOS_REJECTED": {
      return {...state, fetchingPhotos: false, error: action.payload}
    }
    case "FETCH_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingPhotos: false,
        fetchedPhotos: true,
        photos: action.payload
      }
    }

    case "FETCH_PHOTO_DETAIL": {
        return {
            ...state,
            fetchingPhotoDetail:true
        }
    }
    case "FETCH_PHOTO_DETAIL_FULFILLED": {
      var newPhotoDetails = {...state.photoDetails}
      newPhotoDetails[action.payload.image_hash] = action.payload
      return {
        ...state,
        fetchingPhotoDetail: false,
        fetchedPhotoDetail: true,
        photoDetails: newPhotoDetails 
      }
    }
    case "FETCH_PHOTO_DETAIL_REJECTED": {
      return {...state, fetchingPhotoDetail: false, error: action.payload}
    }


    default: {
      return {...state}
    }
  }
}
