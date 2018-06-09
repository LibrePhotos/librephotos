export default function reducer(state={
	scanningPhotos: false,
	scannedPhotos: false,
  error: null,

  photoDetails:{},
  fetchingPhotoDetail: false,
  fetchedPhotoDetail: false,

  photos: {},
  fetchedPhotos: false,
  fetchingPhotos: false,

  favoritePhotos:[],
  fetchingFavoritePhotos:false,
  fetchedFavoritePhotos:false,

  hiddenPhotos:[],
  fetchingHiddenPhotos:false,
  fetchedHiddenPhotos:false,

  noTimestampPhotos: [],
  fetchingNoTimestampPhotos: false,
  fetchedNoTimestampPhotos: false,

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



    case "FETCH_FAVORITE_PHOTOS": {
      return {...state, fetchingFavoritePhotos: true}
    }
    case "FETCH_FAVORITE_PHOTOS_REJECTED": {
      return {...state, fetchingFavoritePhotos: false, error: action.payload}
    }
    case "FETCH_FAVORITE_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingFavoritePhotos: false,
        fetchedFavoritePhotos: true,
        favoritePhotos: action.payload
      }
    }


    case "FETCH_HIDDEN_PHOTOS": {
      return {...state, fetchingHiddenPhotos: true}
    }
    case "FETCH_HIDDEN_PHOTOS_REJECTED": {
      return {...state, fetchingHiddenPhotos: false, error: action.payload}
    }
    case "FETCH_HIDDEN_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingHiddenPhotos: false,
        fetchedHiddenPhotos: true,
        hiddenPhotos: action.payload
      }
    }



    case "FETCH_NO_TIMESTAMP_PHOTOS": {
      return {...state, fetchingNoTimestampPhotos: true}
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_REJECTED": {
      return {...state, fetchingNoTimestampPhotos: false, error: action.payload}
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingNoTimestampPhotos: false,
        fetchedNoTimestampPhotos: true,
        noTimestampPhotos: action.payload
      }
    }




    case "FETCH_PHOTO_DETAIL": {
      return {
          ...state,
          fetchingPhotoDetail:true,
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

	
	case "SET_PHOTOS_FAVORITE_FULFILLED": {
		console.log(action)
		var valFavorite = action.payload.favorite
        var imageHashes = action.payload.image_hashes
        var updatedPhotos = action.payload.updatedPhotos
		var newPhotos = {...state.photoDetails}

        var updatedPhotosImageHashes = updatedPhotos.map((photo)=>photo.image_hash)

		updatedPhotos.forEach((photo)=>{
			newPhotos[[photo.image_hash]] = photo
		})


        var newFavoritePhotos = [...state.favoritePhotos]

        if (valFavorite) {
            updatedPhotos.forEach((photo)=>{
                newFavoritePhotos.push(photo)
            })
        } else {
            console.log(newFavoritePhotos)
            newFavoritePhotos = newFavoritePhotos.filter((photo)=>{
               if (updatedPhotosImageHashes.includes(photo.image_hash)){
                   return false
               } else {
                   return true
               }
            })
        }

		return {...state, photoDetails:newPhotos, favoritePhotos: newFavoritePhotos}
	}






  case "SET_PHOTOS_HIDDEN_FULFILLED": {
		console.log(action)
		var valHidden = action.payload.hidden
        var imageHashes = action.payload.image_hashes
        var updatedPhotos = action.payload.updatedPhotos
		var newPhotos = {...state.photoDetails}

        var updatedPhotosImageHashes = updatedPhotos.map((photo)=>photo.image_hash)

		updatedPhotos.forEach((photo)=>{
			newPhotos[[photo.image_hash]] = photo
		})


        var newHiddenPhotos = [...state.hiddenPhotos]

        if (valFavorite) {
            updatedPhotos.forEach((photo)=>{
                newHiddenPhotos.push(photo)
            })
        } else {
            console.log(newFavoritePhotos)
            newHiddenPhotos = newHiddenPhotos.filter((photo)=>{
               if (updatedPhotosImageHashes.includes(photo.image_hash)){
                   return false
               } else {
                   return true
               }
            })
        }

		return {...state, photoDetails:newPhotos, hiddenPhotos: newHiddenPhotos}
	}







    default: {
      return {...state}
    }
  }
}
