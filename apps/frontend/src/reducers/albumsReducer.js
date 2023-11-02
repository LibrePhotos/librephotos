import { FETCH_USER_ALBUM_FULFILLED, FETCH_USER_ALBUM_REJECTED } from "../actions/albumsActions";
import { DEFAULT_ACTION } from "./common";

const initialState = {
  albumsUserList: [],
  fetchingAlbumsUserList: false,
  fetchedAlbumsUserList: false,

  albumDetails: {},

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

  albumsThing: {},
  fetchingAlbumsThing: false,
  fetchedAlbumsThing: false,

  albumsSharedToMe: [],
  fetchingAlbumsSharedToMe: false,
  fetchedAlbumsSharedToMe: false,

  albumsSharedFromMe: [],
  fetchingAlbumsSharedFromMe: false,
  fetchedAlbumsSharedFromMe: false,

  error: null,
};
export default function reducer(state = initialState, action = DEFAULT_ACTION) {
  let newAlbum;
  switch (action.type) {
    case "FETCH_ALBUMS_SHARED_TO_ME": {
      return { ...state, fetchingAlbumsSharedToMe: true };
    }
    case "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsSharedToMe: false,
        fetchedAlbumsSharedToMe: true,
        albumsSharedToMe: action.payload,
      };
    }
    case "FETCH_ALBUMS_SHARED_TO_ME_REJECTED": {
      return {
        ...state,
        fetchingAlbumsSharedToMe: false,
        fetchedAlbumsSharedToMe: false,
      };
    }

    case "FETCH_ALBUMS_SHARED_FROM_ME": {
      return { ...state, fetchingAlbumsSharedFromMe: true };
    }
    case "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsSharedFromMe: false,
        fetchedAlbumsSharedFromMe: true,
        albumsSharedFromMe: action.payload,
      };
    }
    case "FETCH_ALBUMS_SHARED_FROM_ME_REJECTED": {
      return {
        ...state,
        fetchingAlbumsSharedFromMe: false,
        fetchedAlbumsSharedFromMe: false,
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
        albumsAuto: action.payload,
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
        generatedAlbumsAuto: true,
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
        albumsAutoList: action.payload,
      };
    }

    case "FETCH_AUTO_ALBUMS_RETRIEVE": {
      return { ...state, fetchingAlbumsAutoGalleries: true };
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED": {
      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        error: action.payload,
      };
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED": {
      newAlbum = { ...state.albumsAutoGalleries };
      newAlbum[action.payload.id] = action.payload;
      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: newAlbum,
      };
    }

    case "SET_IDX_TO_IMAGE_HASH": {
      return {
        ...state,
        idx2hash: action.payload,
      };
    }

    case "FETCH_THING_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsThingList: true };
    }
    case "FETCH_THING_ALBUMS_LIST_REJECTED": {
      return {
        ...state,
        fetchingAlbumsThingList: false,
        error: action.payload,
      };
    }
    case "FETCH_THING_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsThingList: false,
        fetchedAlbumsThingList: true,
        albumsThingList: action.payload,
      };
    }

    case "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL": {
      return {
        ...state,
        albumsPlaceListGroupedByGeolocationLevel: action.payload,
      };
    }

    case "FETCH_PLACE_ALBUMS_LIST": {
      return { ...state, fetchingAlbumsPlaceList: true };
    }
    case "FETCH_PLACE_ALBUMS_LIST_REJECTED": {
      return {
        ...state,
        fetchingAlbumsPlaceList: false,
        error: action.payload,
      };
    }
    case "FETCH_PLACE_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsPlaceList: false,
        fetchedAlbumsPlaceList: true,
        albumsPlaceList: action.payload,
      };
    }

    case "FETCH_PLACE_ALBUMS": {
      return { ...state, fetchingAlbumsPlace: true };
    }
    case "FETCH_PLACE_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsPlace: false, error: action.payload };
    }
    case "FETCH_PLACE_ALBUMS_FULFILLED": {
      newAlbum = { ...state.albumsPlace };
      newAlbum[parseInt(action.payload.results.id, 10)] = action.payload.results;
      return {
        ...state,
        fetchingAlbumsPlace: false,
        fetchedAlbumsPlace: true,
        albumsPlace: newAlbum,
      };
    }

    case "FETCH_THING_ALBUMS": {
      return { ...state, fetchingAlbumsThing: true };
    }
    case "FETCH_THING_ALBUMS_REJECTED": {
      return { ...state, fetchingAlbumsThing: false, error: action.payload };
    }
    case "FETCH_THING_ALBUMS_FULFILLED": {
      newAlbum = { ...state.albumsThing };
      newAlbum[parseInt(action.payload.id, 10)] = action.payload;
      return {
        ...state,
        fetchingAlbumsThing: false,
        fetchedAlbumsThing: true,
        albumsThing: newAlbum,
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
        albumsUserList: action.payload,
      };
    }

    case FETCH_USER_ALBUM_FULFILLED: {
      return {
        ...state,
        albumDetails: action.payload.albumDetails,
      };
    }
    case FETCH_USER_ALBUM_REJECTED: {
      return { ...state, fetchingAlbumsUser: false, error: action.payload };
    }

    case "TOGGLE_ALBUM_AUTO_FAVORITE": {
      return { ...state };
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED": {
      return { ...state };
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED": {
      newAlbum = { ...state.albumsAutoGalleries };
      newAlbum[action.payload.id] = action.payload;

      const newAlbumList = [...state.albumsAutoList];

      let index = -1;

      for (let i = 0; i < newAlbumList.length; i += 1) {
        if (newAlbumList[i].id === action.payload.id) {
          index = i;
        }
      }

      if (index !== -1) {
        newAlbumList[index] = action.payload;
      }

      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: newAlbum,
        albumsAutoList: newAlbumList,
      };
    }

    case "auth/logout":
      return { ...initialState };

    default: {
      return { ...state };
    }
  }
}
