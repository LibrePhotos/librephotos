import type { AnyAction } from "redux";

import type { UserPhotosGroup } from "../actions/photosActions";
import type { IncompleteDatePhotosGroup, Photo, PigPhoto } from "../actions/photosActions.types";
import { addTempElementsToFlatList, getPhotosFlatFromGroupedByDate } from "../util/util";

export enum PhotosetType {
  NONE = "none",
  TIMESTAMP = "timestamp",
  NO_TIMESTAMP = "noTimestamp",
  FAVORITES = "favorites",
  PHOTOS = "photos",
  HIDDEN = "hidden",
  RECENTLY_ADDED = "recentlyAdded",
  DELETED = "deleted",
  SEARCH = "search",
  USER_ALBUM = "userAlbum",
  PERSON = "person",
  PUBLIC = "public",
  SHARED_TO_ME = "sharedToMe",
  SHARED_BY_ME = "sharedByMe",
  VIDEOS = "videos",
}

export interface PhotosState {
  scanningPhotos: boolean;
  scannedPhotos: boolean;
  error: string | null;

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

export const initialPhotosState: PhotosState = {
  error: null,
  fetchedPhotos: false,
  fetchedPhotosetType: PhotosetType.NONE,
  fetchingPhotos: false,
  generatedCaptionIm2txt: false,
  generatingCaptionIm2txt: false,
  numberOfPhotos: 0,
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

const DEFAULT_ACTION = { type: "DEFAULT_ACTION" };

export function photos(state = initialPhotosState, action: AnyAction = DEFAULT_ACTION): PhotosState {
  let updatedPhotoDetails: Photo[];
  let newPhotosFlat: PigPhoto[];
  let newPhotosGroupedByDate: IncompleteDatePhotosGroup[];
  let indexToReplace: number;

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

    case "FETCH_RECENTLY_ADDED_PHOTOS": {
      return { ...state, fetchedPhotosetType: PhotosetType.NONE };
    }
    case "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED": {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.RECENTLY_ADDED,
        recentlyAddedPhotosDate: action.payload.date,
      };
    }
    case "FETCH_RECENTLY_ADDED_PHOTOS_REJECTED": {
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
      const { page } = action.payload;
      newPhotosGroupedByDate = [...state.photosGroupedByDate];
      indexToReplace = newPhotosGroupedByDate.findIndex(group => group.id === action.payload.datePhotosGroup.id);
      const groupToChange = newPhotosGroupedByDate[indexToReplace];
      if (!groupToChange) {
        return {
          ...state,
        };
      }
      const { items } = groupToChange;
      const loadedItems = action.payload.datePhotosGroup.items;
      groupToChange.items = items
        .slice(0, (page - 1) * 100)
        .concat(loadedItems)
        .concat(items.slice(page * 100));
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
    case "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED": {
      return { ...state };
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED": {
      const { fetchedPage, photosCount } = action.payload;
      let currentPhotos = [...state.photosFlat];
      if (fetchedPage === 1) {
        currentPhotos = addTempElementsToFlatList(photosCount);
      }
      newPhotosFlat = currentPhotos
        .slice(0, (fetchedPage - 1) * 100)
        .concat(action.payload.photosFlat)
        .concat(currentPhotos.slice(fetchedPage * 100));
      return {
        ...state,
        photosFlat: newPhotosFlat,
        fetchedPhotosetType: PhotosetType.NO_TIMESTAMP,
        numberOfPhotos: photosCount,
      };
    }
    case "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED": {
      return resetPhotos(state, action.payload);
    }
    case "FETCH_PHOTOSET": {
      return { ...state, fetchedPhotosetType: PhotosetType.NONE };
    }
    case "FETCH_PHOTOSET_FULFILLED": {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: action.payload.photosetType,
        photosGroupedByDate: action.payload.photosGroupedByDate ?? [],
        photosGroupedByUser: action.payload.photosGroupedByUser ?? [],
      };
    }
    case "FETCH_PHOTOSET_REJECTED": {
      return resetPhotos(state, action.payload);
    }
    case "SET_PHOTOS_FAVORITE_FULFILLED": {
      updatedPhotoDetails = action.payload.updatedPhotos as Photo[];
      newPhotosGroupedByDate = [...state.photosGroupedByDate];
      newPhotosFlat = [...state.photosFlat];

      updatedPhotoDetails.forEach(photoDetails => {
        newPhotosFlat = newPhotosFlat.map(photo =>
          photo.id === photoDetails.image_hash ? { ...photo, rating: photoDetails.rating } : photo
        );
        newPhotosGroupedByDate = newPhotosGroupedByDate.map(group =>
          // Create a new group object if the photo exists in its items (don't mutate).
          group.items.findIndex(photo => photo.id === photoDetails.image_hash) === -1
            ? group
            : {
                ...group,
                items: group.items.map(item =>
                  item.id !== photoDetails.image_hash
                    ? item
                    : {
                        ...item,
                        rating: photoDetails.rating,
                      }
                ),
              }
        );

        if (state.fetchedPhotosetType === PhotosetType.FAVORITES && !action.payload.favorite) {
          // Remove the photo from the photo set. (Ok to mutate, since we've already created a new group.)
          newPhotosGroupedByDate = newPhotosGroupedByDate.map(group => ({
            ...group,
            items: group.items.filter(item => item.id !== photoDetails.image_hash),
          }));
          newPhotosFlat = newPhotosFlat.filter(item => item.id !== photoDetails.image_hash);
        }
      });

      // Keep only groups that still contain photos
      newPhotosGroupedByDate = newPhotosGroupedByDate.filter(group => group.items.length > 0);

      return {
        ...state,
        photosFlat: newPhotosFlat,
        photosGroupedByDate: newPhotosGroupedByDate,
      };
    }

    case "FETCH_USER_ALBUM_FULFILLED": {
      return {
        ...state,
        photosFlat: action.payload.photosFlat,
        fetchedPhotosetType: PhotosetType.USER_ALBUM,
        photosGroupedByDate: action.payload.photosGroupedByDate,
      };
    }
    case "FETCH_USER_ALBUM_REJECTED": {
      return resetPhotos(state, action.payload);
    }

    case "auth/logout":
      return { ...initialPhotosState };

    default: {
      return { ...state };
    }
  }
}
