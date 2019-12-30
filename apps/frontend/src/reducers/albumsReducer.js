export default function reducer(
  state = {
    albumsUserList: [],
    fetchingAlbumsUserList: false,
    fetchedAlbumsUserList: false,

    albumsUser: {},
    fetchingAlbumsUser: false,
    fetchedAlbumsUser: false,

    albumsPeople: [],
    fetchingAlbumsPeople: false,
    fetchedAlbumsPeople: false,

    albumsAuto: [],
    fetchingAlbumsAuto: false,
    fetchedAlbumsAuto: false,

    generatingAlbumsAuto: false,
    generatedAlbumsAuto: false,

    albumsAutoList: [],
    fetchingAlbumsAutoList: false,
    fetchedAlbumsAutoList: false,

    albumsAutoGalleries: {},
    fetchingAlbumsAutoGalleries: false,
    fetchedAlbumsAutoGalleries: false,

    albumsDateList: [],
    fetchingAlbumsDateList: false,
    fetchedAlbumsDateList: false,

    albumsDatePhotoHashList: [],
    fetchingAlbumsDatePhotoHashList: false,
    fetchedAlbumsDatePhotoHashList: false,
    idx2hash: [],

    albumsDateGalleries: {},
    fetchingAlbumsDateGalleries: false,
    fetchedAlbumsDateGalleries: false,

    albumsThingList: [],
    fetchingAlbumsThingList: false,
    fetchedAlbumsThingList: false,

    albumsPlaceList: [],
    albumsPlaceListGroupedByGeolocationLevel: {},
    fetchingAlbumsPlaceList: false,
    fetchedAlbumsPlaceList: false,

    albumsPlace: {},
    fetchingAlbumsPlace: false,
    fetchedAlbumsPlace: false,

    albumsSharedToMe: [],
    fetchingAlbumsSharedToMe: false,
    fetchedAlbumsSharedToMe: false,

    albumsSharedFromMe: [],
    fetchingAlbumsSharedFromMe: false,
    fetchedAlbumsSharedFromMe: false,

    error: null
  },
  action
) {
  switch (action.type) {


    case "FETCH_ALBUMS_SHARED_TO_ME": {
      return { ...state, fetchingAlbumsSharedToMe: true };
    }
    case "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsSharedToMe: false,
        fetchedAlbumsSharedToMe: true,
        albumsSharedToMe: action.payload
      };
    }
    case "FETCH_ALBUMS_SHARED_TO_ME_REJECTED": {
      return {
        ...state,
        fetchingAlbumsSharedToMe: false,
        fetchedAlbumsSharedToMe: false
      };
    }


    case "FETCH_ALBUMS_SHARED_FROM_ME": {
      return { ...state, fetchingAlbumsSharedFromMe: true };
    }
    case "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED": {
      console.log(action.payload)
      return {
        ...state,
        fetchingAlbumsSharedFromMe: false,
        fetchedAlbumsSharedFromMe: true,
        albumsSharedFromMe: action.payload
      };
    }
    case "FETCH_ALBUMS_SHARED_FROM_ME_REJECTED": {
      return {
        ...state,
        fetchingAlbumsSharedFromMe: false,
        fetchedAlbumsSharedFromMe: false
      };
    }



    case "FETCH_PEOPLE_ALBUMS": {
      return { ...state, fetchingAlbumsPeople: true };
    }
    case "FETCH_PEOPLE_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsPeople: false, error: action.payload };
    }
    case "FETCH_PEOPLE_ALBUMS_FULFILLED": {
      var new_album = { ...state.albumsPeople };
      new_album[action.payload.id] = action.payload;
      return {
        ...state,
        fetchingAlbumsPeople: false,
        fetchedAlbumsPeople: true,
        albumsPeople: new_album
      };
    }

    case "FETCH_AUTO_ALBUMS": {
      return { ...state, fetchingAlbumsAuto: true };
    }
    case "FETCH_AUTO_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsAuto: false, error: action.payload };
    }
    case "FETCH_AUTO_ALBUMS_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsAuto: false,
        fetchedAlbumsAuto: true,
        albumsAuto: action.payload
      };
    }

    case "GENERATE_AUTO_ALBUMS": {
      return { ...state, generatingAlbumsAuto: true };
    }
    case "GENERATE_AUTO_ALBUMS_REJECTED": {
      return { ...state, generatingAlbumsAuto: false, error: action.payload };
    }
    case "GENERATE_AUTO_ALBUMS_FULFILLED": {
      return {
        ...state,
        generatingAlbumsAuto: false,
        generatedAlbumsAuto: true
      };
    }

    case "FETCH_AUTO_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsAutoList: true };
    }
    case "FETCH_AUTO_ALBUMS_LIST_REJECTED": {
      return { ...state, fetchingAlbumsAutoList: false, error: action.payload };
    }
    case "FETCH_AUTO_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsAutoList: false,
        fetchedAlbumsAutoList: true,
        albumsAutoList: action.payload
      };
    }

    case "FETCH_AUTO_ALBUMS_RETRIEVE": {
      return { ...state, fetchingAlbumsAutoGalleries: true };
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED": {
      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        error: action.payload
      };
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED": {
      var new_album = { ...state.albumsAutoGalleries };
      new_album[action.payload.id] = action.payload;
      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: new_album
      };
    }

    case "FETCH_DATE_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsDateList: true };
    }
    case "FETCH_DATE_ALBUMS_LIST_REJECTED": {
      return { ...state, fetchingAlbumsDateList: false, error: action.payload };
    }
    case "FETCH_DATE_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsDateList: false,
        fetchedAlbumsDateList: true,
        albumsDateList: action.payload
      };
    }

    case "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST": {
      return { ...state, fetchingAlbumsDatePhotoHashList: true };
    }
    case "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST_REJECTED": {
      return {
        ...state,
        fetchingAlbumsDatePhotoHashList: false,
        error: action.payload
      };
    }
    case "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsDatePhotoHashList: false,
        fetchedAlbumsDatePhotoHashList: true,
        albumsDatePhotoHashList: action.payload
      };
    }

    case "SET_IDX_TO_IMAGE_HASH": {
      return {
        ...state,
        idx2hash: action.payload
      };
    }

    case "FETCH_DATE_ALBUMS_RETRIEVE": {
      return { ...state, fetchingAlbumsDateGalleries: true };
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED": {
      return {
        ...state,
        fetchingAlbumsDateGalleries: false,
        error: action.payload
      };
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED": {
      var new_album = { ...state.albumsDateGalleries };
      new_album[action.payload.id] = action.payload;
      return {
        ...state,
        fetchingAlbumsDateGalleries: false,
        fetchedAlbumsDateGalleries: true,
        albumsDateGalleries: new_album
      };
    }

    case "FETCH_THING_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsThingList: true };
    }
    case "FETCH_THING_ALBUMS_LIST_REJECTED": {
      return {
        ...state,
        fetchingAlbumsThingList: false,
        error: action.payload
      };
    }
    case "FETCH_THING_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsThingList: false,
        fetchedAlbumsThingList: true,
        albumsThingList: action.payload
      };
    }

    case "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL": {
      return {
        ...state,
        albumsPlaceListGroupedByGeolocationLevel: action.payload
      };
    }

    case "FETCH_PLACE_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsPlaceList: true };
    }
    case "FETCH_PLACE_ALBUMS_LIST_REJECTED": {
      return {
        ...state,
        fetchingAlbumsPlaceList: false,
        error: action.payload
      };
    }
    case "FETCH_PLACE_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsPlaceList: false,
        fetchedAlbumsPlaceList: true,
        albumsPlaceList: action.payload
      };
    }

    case "FETCH_PLACE_ALBUMS": {
      return { ...state, fetchingAlbumsPlace: true };
    }
    case "FETCH_PLACE_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsPlace: false, error: action.payload };
    }
    case "FETCH_PLACE_ALBUMS_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsPlace: false,
        fetchedAlbumsPlace: true,
        albumsPlace: {
          ...state.albumsPlace,
          [action.payload.id]: action.payload
        }
      };
    }

    case "FETCH_USER_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsUserList: true };
    }
    case "FETCH_USER_ALBUMS_LIST_REJECTED": {
      return { ...state, fetchingAlbumsUserList: false, error: action.payload };
    }
    case "FETCH_USER_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsUserList: false,
        fetchedAlbumsUserList: true,
        albumsUserList: action.payload
      };
    }

    case "FETCH_USER_ALBUMS": {
      return { ...state, fetchingAlbumsUser: true };
    }
    case "FETCH_USER_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsUser: false, error: action.payload };
    }
    case "FETCH_USER_ALBUMS_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsUser: false,
        fetchedAlbumsUser: true,
        albumsUser: { ...state.albumsUser, [action.payload.id]: action.payload }
      };
    }

    case "TOGGLE_ALBUM_AUTO_FAVORITE": {
      return { ...state };
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED": {
      return { ...state };
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED": {
      var new_album = { ...state.albumsAutoGalleries };
      new_album[action.payload.id] = action.payload;

      var new_album_list = [...state.albumsAutoList];

      var index = -1;

      for (var i = 0; i < new_album_list.length; i++) {
        if (new_album_list[i].id === action.payload.id) {
          index = i;
        }
      }

      if (index !== -1) {
        new_album_list[index] = action.payload;
      }

      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: new_album,
        albumsAutoList: new_album_list
      };
    }

    default: {
      return { ...state };
    }
  }
}

// FETCH_AUTO_ALBUMS_LIST
// FETCH_AUTO_ALBUMS_LIST_FULFILLED
// FETCH_AUTO_ALBUMS_LIST_REJECTED

// TOGGLE_ALBUM_AUTO_FAVORITE
// TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED
// TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED
