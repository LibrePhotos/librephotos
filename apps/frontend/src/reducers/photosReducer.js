export default function reducer(
  state = {
    scanningPhotos: false,
    scannedPhotos: false,
    error: null,

    photoDetails: {},
    fetchingPhotoDetail: false,
    fetchedPhotoDetail: false,

    photos: {},
    fetchedPhotos: false,
    fetchingPhotos: false,

    favoritePhotos: [],
    fetchingFavoritePhotos: false,
    fetchedFavoritePhotos: false,

    hiddenPhotos: [],
    fetchingHiddenPhotos: false,
    fetchedHiddenPhotos: false,

    noTimestampPhotos: [],
    fetchingNoTimestampPhotos: false,
    fetchedNoTimestampPhotos: false,

    publicPhotos: [],
    fetchingPublicPhotos: false,
    fetchedPublicPhotos: false,

    photosSharedToMe: [],
    fetchingPhotosSharedToMe: false,
    fetchedPhotosSharedToMe: false,

    photosSharedFromMe: [],
    fetchingPhotosSharedFromMe: false,
    fetchedPhotosSharedFromMe: false,

    recentlyAddedPhotos: [],
    recentlyAddedIdx2hash: [],
    fetchingRecentlyAddedPhotos: false,
    fetchedRecentlyAddedPhotos: false,

    generatingCaptionIm2txt: false,
    generatedCaptionIm2txt: false,
  },
  action
) {
  switch (action.type) {
    case "GENERATE_PHOTO_CAPTION": {
      return {...state, generatingCaptionIm2txt: true}
    }

    case "GENERATE_PHOTO_CAPTION_FULFILLED": {
      return {...state, generatingCaptionIm2txt: false, generatedCaptionIm2txt: true}
    }

    case "GENERATE_PHOTO_CAPTION_REJECTED": {
      return {...state, generatingCaptionIm2txt: false, generatedCaptionIm2txt: false}
    }






    case "FETCH_RECENTLY_ADDED_PHOTOS" : {
      return {...state, fetchingRecentlyAddedPhotos: true}
    } 

    case "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED" : {
      return {
        ...state,
        fetchingRecentlyAddedPhotos: false,
        fetchedRecentlyAddedPhotos: true,
        recentlyAddedPhotos: action.payload.res,
        recentlyAddedIdx2hash: action.payload.idx2hash
           
      }
    } 

    case "FETCH_RECENTLY_ADDED_PHOTOS_REJECTED" : {
      return {
        ...state,
        fetchingRecentlyAddedPhotos: false,
        fetchedRecentlyAddedPhotos: false
      }
    } 






    case "FETCH_PHOTOS_SHARED_TO_ME": {
      return { ...state, fetchingPhotosSharedToMe: true };
    }
    case "FETCH_PHOTOS_SHARED_TO_ME_FULFILLED": {
      return {
        ...state,
        fetchingPhotosSharedToMe: false,
        fetchedPhotosSharedToMe: true,
        photosSharedToMe: action.payload
      };
    }
    case "FETCH_PHOTOS_SHARED_TO_ME_REJECTED": {
      return {
        ...state,
        fetchingPhotosSharedToMe: false,
        fetchedPhotosSharedToMe: false
      };
    }



    case "FETCH_PHOTOS_SHARED_FROM_ME": {
      return { ...state, fetchingPhotosSharedFromMe: true };
    }
    case "FETCH_PHOTOS_SHARED_FROM_ME_FULFILLED": {
      return {
        ...state,
        fetchingPhotosSharedFromMe: false,
        fetchedPhotosSharedFromMe: true,
        photosSharedFromMe: action.payload
      };
    }
    case "FETCH_PHOTOS_SHARED_FROM_ME_REJECTED": {
      return {
        ...state,
        fetchingPhotosSharedFromMe: false,
        fetchedPhotosSharedFromMe: false
      };
    }






    case "SCAN_PHOTOS": {
      return { ...state, scanningPhotos: true };
    }
    case "SCAN_PHOTOS_REJECTED": {
      return { ...state, scanningPhotos: false, error: action.payload };
    }
    case "SCAN_PHOTOS_FULFILLED": {
      return {
        ...state,
        scanningPhotos: false,
        scannedPhotos: true
      };
    }

    case "FETCH_PHOTOS": {
      return { ...state, fetchingPhotos: true };
    }
    case "FETCH_PHOTOS_REJECTED": {
      return { ...state, fetchingPhotos: false, error: action.payload };
    }
    case "FETCH_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingPhotos: false,
        fetchedPhotos: true,
        photos: action.payload
      };
    }

    case "FETCH_FAVORITE_PHOTOS": {
      return { ...state, fetchingFavoritePhotos: true };
    }
    case "FETCH_FAVORITE_PHOTOS_REJECTED": {
      return { ...state, fetchingFavoritePhotos: false, error: action.payload };
    }
    case "FETCH_FAVORITE_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingFavoritePhotos: false,
        fetchedFavoritePhotos: true,
        favoritePhotos: action.payload
      };
    }

    case "FETCH_HIDDEN_PHOTOS": {
      return { ...state, fetchingHiddenPhotos: true };
    }
    case "FETCH_HIDDEN_PHOTOS_REJECTED": {
      return { ...state, fetchingHiddenPhotos: false, error: action.payload };
    }
    case "FETCH_HIDDEN_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingHiddenPhotos: false,
        fetchedHiddenPhotos: true,
        hiddenPhotos: action.payload
      };
    }

    case "FETCH_NO_TIMESTAMP_PHOTOS": {
      return { ...state, fetchingNoTimestampPhotos: true };
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_REJECTED": {
      return {
        ...state,
        fetchingNoTimestampPhotos: false,
        error: action.payload
      };
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingNoTimestampPhotos: false,
        fetchedNoTimestampPhotos: true,
        noTimestampPhotos: action.payload
      };
    }

    case "FETCH_PHOTO_DETAIL": {
      return {
        ...state,
        fetchingPhotoDetail: true
      };
    }
    case "FETCH_PHOTO_DETAIL_FULFILLED": {
      var newPhotoDetails = { ...state.photoDetails };
      newPhotoDetails[action.payload.image_hash] = action.payload;
      return {
        ...state,
        fetchingPhotoDetail: false,
        fetchedPhotoDetail: true,
        photoDetails: newPhotoDetails
      };
    }
    case "FETCH_PHOTO_DETAIL_REJECTED": {
      return { ...state, fetchingPhotoDetail: false, error: action.payload };
    }

    case "SET_PHOTOS_PUBLIC_FULFILLED": {
      var valPublic = action.payload.public;
      var imageHashes = action.payload.image_hashes;
      var updatedPhotos = action.payload.updatedPhotos;
      var newPhotos = { ...state.photoDetails };

      var updatedPhotosImageHashes = updatedPhotos.map(
        photo => photo.image_hash
      );

      updatedPhotos.forEach(photo => {
        newPhotos[[photo.image_hash]] = photo;
      });

      var newPublicPhotos = [...state.publicPhotos];

      if (valPublic) {
        updatedPhotos.forEach(photo => {
          newPublicPhotos.push(photo);
        });
      } else {
        newPublicPhotos = newPublicPhotos.filter(photo => {
          if (updatedPhotosImageHashes.includes(photo.image_hash)) {
            return false;
          } else {
            return true;
          }
        });
      }

      return {
        ...state,
        photoDetails: newPhotos,
        publicPhotos: newPublicPhotos
      };
    }

    case "SET_PHOTOS_FAVORITE_FULFILLED": {
      var valFavorite = action.payload.favorite;
      var imageHashes = action.payload.image_hashes;
      var updatedPhotos = action.payload.updatedPhotos;
      var newPhotos = { ...state.photoDetails };

      var updatedPhotosImageHashes = updatedPhotos.map(
        photo => photo.image_hash
      );

      updatedPhotos.forEach(photo => {
        newPhotos[[photo.image_hash]] = photo;
      });

      var newFavoritePhotos = [...state.favoritePhotos];

      if (valFavorite) {
        updatedPhotos.forEach(photo => {
          newFavoritePhotos.push(photo);
        });
      } else {
        newFavoritePhotos = newFavoritePhotos.filter(photo => {
          if (updatedPhotosImageHashes.includes(photo.image_hash)) {
            return false;
          } else {
            return true;
          }
        });
      }

      return {
        ...state,
        photoDetails: newPhotos,
        favoritePhotos: newFavoritePhotos
      };
    }

    case "SET_PHOTOS_HIDDEN_FULFILLED": {
      var valHidden = action.payload.hidden;
      var imageHashes = action.payload.image_hashes;
      var updatedPhotos = action.payload.updatedPhotos;
      var newPhotos = { ...state.photoDetails };

      var updatedPhotosImageHashes = updatedPhotos.map(
        photo => photo.image_hash
      );

      updatedPhotos.forEach(photo => {
        newPhotos[[photo.image_hash]] = photo;
      });

      var newHiddenPhotos = [...state.hiddenPhotos];

      if (valFavorite) {
        updatedPhotos.forEach(photo => {
          newHiddenPhotos.push(photo);
        });
      } else {
        newHiddenPhotos = newHiddenPhotos.filter(photo => {
          if (updatedPhotosImageHashes.includes(photo.image_hash)) {
            return false;
          } else {
            return true;
          }
        });
      }

      return {
        ...state,
        photoDetails: newPhotos,
        hiddenPhotos: newHiddenPhotos
      };
    }

    default: {
      return { ...state };
    }
  }
}
