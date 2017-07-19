export default function reducer(state={
	scanningPhotos: false,
	scannedPhotos: false,
    error: null,
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


    default: {
      return {...state}
    }
  }
}
