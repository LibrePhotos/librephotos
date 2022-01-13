import { AnyAction } from "redux";
import {
  FETCH_PERSON_PHOTOS_FULFILLED,
  FETCH_PERSON_PHOTOS_REJECTED,
  FETCH_USER_ALBUM_FULFILLED,
  FETCH_USER_ALBUM_REJECTED,
} from "../actions/albumsActions";
import {
  FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED,
  FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED,
  FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED,
  FETCH_PHOTOSET,
  FETCH_PHOTOSET_FULFILLED,
  FETCH_PHOTOSET_REJECTED,
  FETCH_RECENTLY_ADDED_PHOTOS,
  FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED,
  FETCH_RECENTLY_ADDED_PHOTOS_REJECTED,
  SET_PHOTOS_FAVORITE_FULFILLED,
  SET_PHOTOS_PUBLIC_FULFILLED,
  SET_PHOTOS_HIDDEN_FULFILLED,
  UserPhotosGroup,
} from "../actions/photosActions";
import {
  SEARCH_PHOTOS_FULFILLED,
  SEARCH_PHOTOS_REJECTED,
} from "../actions/searchActions";
import {
  addTempElementsToFlatList,
  getPhotosFlatFromGroupedByDate,
} from "../util/util";
import {
  IncompleteDatePhotosGroup,
  Photo,
  PigPhoto,
} from "../actions/photosActions.types";

export enum PhotosetType {
  NONE = "none",
  TIMESTAMP = "timestamp",
  NO_TIMESTAMP = "noTimestamp",
  FAVORITES = "favorites",
  HIDDEN = "hidden",
  RECENTLY_ADDED = "recentlyAdded",
  SEARCH = "search",
  USER_ALBUM = "userAlbum",
  PERSON = "person",
  PUBLIC = "public",
  SHARED_TO_ME = "sharedToMe",
  SHARED_BY_ME = "sharedByMe",
}

export interface PhotosState {
  scanningPhotos: boolean;
  scannedPhotos: boolean;
  error: string | null;

  photoDetails: { [key: string]: Photo };
  fetchingPhotoDetail: boolean;
  fetchedPhotoDetail: boolean;

  fetchedPhotos: boolean;
  fetchingPhotos: boolean;

  photosFlat: PigPhoto[];
  photosGroupedByDate: IncompleteDatePhotosGroup[]; //  | GroupedPhotosSerializer[]
  photosGroupedByUser: UserPhotosGroup[];
  fetchedPhotosetType: PhotosetType;
  numberOfPhotos: number;

  recentlyAddedPhotosDate?: Date;

  generatingCaptionIm2txt: boolean;
  generatedCaptionIm2txt: boolean;
}

const initialPhotosState: PhotosState = {
  error: null,
  fetchedPhotoDetail: false,
  fetchedPhotos: false,
  fetchedPhotosetType: PhotosetType.NONE,
  fetchingPhotoDetail: false,
  fetchingPhotos: false,
  generatedCaptionIm2txt: false,
  generatingCaptionIm2txt: false,
  numberOfPhotos: 0,
  photoDetails: {},
  photosFlat: [],
  photosGroupedByDate: [],
  photosGroupedByUser: [],
  scannedPhotos: false,
  scanningPhotos: false,
};

function resetPhotos(state: PhotosState, error: string) {
  return {
    ...state,
    photosFlat: [],
    fetchedPhotosetType: PhotosetType.NONE,
    photosGroupedByDate: [],
    photosGroupedByUser: [],
    error: error,
  };
}

function updatePhotoDetails(state: PhotosState, action: AnyAction) {
  var updatedPhotoDetails = action.payload.updatedPhotos as Photo[];
  var newPhotoDetails = { ...state.photoDetails };

  updatedPhotoDetails.forEach((photoDetails) => {
    newPhotoDetails[photoDetails.image_hash] = photoDetails;
  });

  return {
    ...state,
    photoDetails: newPhotoDetails,
  };
}

export default function photosReducer(
  state = initialPhotosState,
  action: AnyAction
): PhotosState {
  var updatedPhotoDetails;
  var newPhotosFlat: PigPhoto[];
  var newPhotosGroupedByDate: IncompleteDatePhotosGroup[];
  var indexToReplace: number;

  switch (action.type) {
    case "GENERATE_PHOTO_CAPTION": {
      return { ...state, generatingCaptionIm2txt: true };
    }

    case "GENERATE_PHOTO_CAPTION_FULFILLED": {
      return {
        ...state,
        generatingCaptionIm2txt: false,
        generatedCaptionIm2txt: true,
      };
    }

    case "GENERATE_PHOTO_CAPTION_REJECTED": {
      return {
        ...state,
        generatingCaptionIm2txt: false,
        generatedCaptionIm2txt: false,
      };
    }

    case FETCH_RECENTLY_ADDED_PHOTOS: {
      return { ...state, fetchedPhotosetType: PhotosetType.NONE };
    }
    case FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED: {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.RECENTLY_ADDED,
        recentlyAddedPhotosDate: action.payload.date,
      };
    }
    case FETCH_RECENTLY_ADDED_PHOTOS_REJECTED: {
      return resetPhotos(state, action.payload);
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
        scannedPhotos: true,
      };
    }

    case "FETCH_DATE_ALBUMS_RETRIEVE": {
      return { ...state };
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED": {
      return resetPhotos(state, action.payload);
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED": {
      var page = action.payload.page;
      newPhotosGroupedByDate = [...state.photosGroupedByDate];
      indexToReplace = newPhotosGroupedByDate.findIndex(
        (group) => group.id === action.payload.datePhotosGroup.id
      );
      var groupToChange = newPhotosGroupedByDate[indexToReplace];
      if (!groupToChange) {
        return {
          ...state,
        };
      }
      var items = groupToChange.items;
      var loadedItems = action.payload.datePhotosGroup.items;
      var updatedItems = items
        .slice(0, (page - 1) * 100)
        .concat(loadedItems)
        .concat(items.slice(page * 100));
      groupToChange.items = updatedItems;
      newPhotosGroupedByDate[indexToReplace] = groupToChange;
      return {
        ...state,
        photosFlat: getPhotosFlatFromGroupedByDate(newPhotosGroupedByDate),
        photosGroupedByDate: newPhotosGroupedByDate,
      };
    }
    case "FETCH_DATE_ALBUMS_LIST": {
      return { ...state, fetchedPhotosetType: PhotosetType.NONE };
    }
    case "FETCH_DATE_ALBUMS_LIST_REJECTED": {
      return resetPhotos(state, action.payload);
    }
    case "FETCH_DATE_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: action.payload.photosetType,
        photosGroupedByDate: action.payload.photosGroupedByDate,
      };
    }
    case FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED: {
      return { ...state };
    }
    case FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED: {
      var fetched_page = action.payload.fetchedPage;
      var photos_count = action.payload.photosCount;
      var current_photos = [...state.photosFlat];
      if (fetched_page == 1) {
        current_photos = addTempElementsToFlatList(photos_count);
      }
      newPhotosFlat = current_photos
        .slice(0, (fetched_page - 1) * 100)
        .concat(action.payload.photosFlat)
        .concat(current_photos.slice(fetched_page * 100));
      return {
        ...state,
        photosFlat: newPhotosFlat,
        fetchedPhotosetType: PhotosetType.NO_TIMESTAMP,
        numberOfPhotos: photos_count,
      };
    }
    case FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED: {
      return resetPhotos(state, action.payload);
    }
    case FETCH_PHOTOSET: {
      return { ...state, fetchedPhotosetType: PhotosetType.NONE };
    }
    case FETCH_PHOTOSET_FULFILLED: {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: action.payload.photosetType,
        photosGroupedByDate: action.payload.photosGroupedByDate
          ? action.payload.photosGroupedByDate
          : [],
        photosGroupedByUser: action.payload.photosGroupedByUser
          ? action.payload.photosGroupedByUser
          : [],
      };
    }
    case FETCH_PHOTOSET_REJECTED: {
      return resetPhotos(state, action.payload);
    }

    case "FETCH_PHOTO_DETAIL": {
      return {
        ...state,
        fetchingPhotoDetail: true,
      };
    }
    case "FETCH_PHOTO_DETAIL_FULFILLED": {
      var newPhotoDetails = { ...state.photoDetails };
      const photoDetails: Photo = action.payload;
      newPhotoDetails[photoDetails.image_hash] = photoDetails;
      return {
        ...state,
        fetchingPhotoDetail: false,
        fetchedPhotoDetail: true,
        photoDetails: newPhotoDetails,
      };
    }
    case "FETCH_PHOTO_DETAIL_REJECTED": {
      return { ...state, fetchingPhotoDetail: false, error: action.payload };
    }

    case SET_PHOTOS_PUBLIC_FULFILLED: {
      return updatePhotoDetails(state, action);
    }

    case SET_PHOTOS_FAVORITE_FULFILLED: {
      updatedPhotoDetails = action.payload.updatedPhotos as Photo[];
      newPhotoDetails = { ...state.photoDetails };
      newPhotosGroupedByDate = [...state.photosGroupedByDate];
      newPhotosFlat = [...state.photosFlat];

      updatedPhotoDetails.forEach((photoDetails) => {
        newPhotoDetails[photoDetails.image_hash] = photoDetails;

        newPhotosFlat = newPhotosFlat.map((photo) =>
          photo.id === photoDetails.image_hash
            ? { ...photo, rating: photoDetails.rating }
            : photo
        );
        newPhotosGroupedByDate = newPhotosGroupedByDate.map((group) =>
          // Create a new group object if the photo exists in its items (don't mutate).
          group.items.findIndex(
            (photo) => photo.id === photoDetails.image_hash
          ) === -1
            ? group
            : {
                ...group,
                items: group.items.map((item) =>
                  item.id !== photoDetails.image_hash
                    ? item
                    : {
                        ...item,
                        rating: photoDetails.rating,
                      }
                ),
              }
        );

        if (
          state.fetchedPhotosetType === PhotosetType.FAVORITES &&
          !action.payload.favorite
        ) {
          // Remove the photo from the photo set. (Ok to mutate, since we've already created a new group.)
          newPhotosGroupedByDate.forEach(
            (group) =>
              (group.items = group.items.filter(
                (item) => item.id !== photoDetails.image_hash
              ))
          );
          newPhotosFlat = newPhotosFlat.filter(
            (item) => item.id !== photoDetails.image_hash
          );
        }
      });

      // Keep only groups that still contain photos
      newPhotosGroupedByDate = newPhotosGroupedByDate.filter(
        (group) => group.items.length > 0
      );

      return {
        ...state,
        photoDetails: newPhotoDetails,
        photosFlat: newPhotosFlat,
        photosGroupedByDate: newPhotosGroupedByDate,
      };
    }

    case SET_PHOTOS_HIDDEN_FULFILLED: {
      return updatePhotoDetails(state, action);
    }

    case SEARCH_PHOTOS_FULFILLED: {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.SEARCH,
        photosGroupedByDate: action.payload.photosGroupedByDate,
      };
    }

    case SEARCH_PHOTOS_REJECTED: {
      return resetPhotos(state, action.payload);
    }

    case FETCH_USER_ALBUM_FULFILLED: {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.USER_ALBUM,
        photosGroupedByDate: action.payload.photosGroupedByDate,
      };
    }
    case FETCH_USER_ALBUM_REJECTED: {
      return resetPhotos(state, action.payload);
    }

    case FETCH_PERSON_PHOTOS_FULFILLED: {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.PERSON,
        photosGroupedByDate: action.payload.photosGroupedByDate,
      };
    }
    case FETCH_PERSON_PHOTOS_REJECTED: {
      return resetPhotos(state, action.payload);
    }
    case "LOGOUT": {
      return resetPhotos(state, action.payload);
    }
    default: {
      return { ...state };
    }
  }
}
