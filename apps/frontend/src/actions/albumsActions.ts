import { showNotification } from "@mantine/notifications";
import _ from "lodash";
import type { Dispatch } from "react";
import { z } from "zod";

import { Server } from "../api_client/apiClient";
import i18n from "../i18n";
import { PhotosetType } from "../reducers/photosReducer";
import type { AppDispatch } from "../store/store";
import { addTempElementsToGroups, getPhotosFlatFromGroupedByDate } from "../util/util";
import type {
  AlbumInfo,
  AutoAlbum,
  AutoAlbumInfo,
  PlaceAlbumInfo,
  ThingAlbum,
  UserAlbumDetails,
  UserAlbumInfo,
} from "./albumActions.types";
import {
  AutoAlbumSchema,
  FetchAutoAlbumsListResponseSchema,
  FetchDateAlbumsListResponseSchema,
  FetchPlaceAlbumsListResponseSchema,
  FetchThingAlbumResponseSchema,
  FetchThingAlbumsListResponseSchema,
  FetchUserAlbumsListResponseSchema,
  FetchUserAlbumsSharedResponseSchema,
  PlaceAlbumSchema,
  UserAlbumEditResponseSchema,
  UserAlbumInfoSchema,
  UserAlbumSchema,
} from "./albumActions.types";
import type { DatePhotosGroup, IncompleteDatePhotosGroup } from "./photosActions.types";
import { IncompleteDatePhotosGroupSchema } from "./photosActions.types";

export function fetchThingAlbumsList() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS_LIST" });
    Server.get("albums/thing/list/")
      .then(response => {
        const data = FetchThingAlbumsListResponseSchema.parse(response.data);
        const albumInfoList: AlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_THING_ALBUMS_LIST_FULFILLED",
          payload: albumInfoList,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_THING_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchThingAlbum(album_id: string) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS" });
    Server.get(`albums/thing/${album_id}/`)
      .then(response => {
        const data = FetchThingAlbumResponseSchema.parse(response.data);
        const thingAlbum: ThingAlbum = data.results;
        dispatch({
          type: "FETCH_THING_ALBUMS_FULFILLED",
          payload: thingAlbum,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_THING_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsList() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_USER_ALBUMS_LIST" });
    Server.get("albums/user/list/")
      .then(response => {
        const data = FetchUserAlbumsListResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_USER_ALBUMS_LIST_FULFILLED",
          payload: userAlbumInfoList,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export const FETCH_USER_ALBUM = "FETCH_USER_ALBUM";
export const FETCH_USER_ALBUM_FULFILLED = "FETCH_USER_ALBUM_FULFILLED";
export const FETCH_USER_ALBUM_REJECTED = "FETCH_USER_ALBUM_REJECTED";

export function fetchUserAlbum(album_id: number) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_USER_ALBUM });
    Server.get(`albums/user/${album_id}/`)
      .then(response => {
        const data = UserAlbumSchema.parse(response.data);
        const photosGroupedByDate: DatePhotosGroup[] = data.grouped_photos;
        const albumDetails: UserAlbumDetails = data;
        dispatch({
          type: FETCH_USER_ALBUM_FULFILLED,
          payload: {
            photosGroupedByDate,
            photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
            albumDetails,
          },
        });
      })
      .catch(err => {
        dispatch({ type: FETCH_USER_ALBUM_REJECTED, payload: err });
      });
  };
}

export function createNewUserAlbum(title: string, image_hashes: string[]) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "CREATE_USER_ALBUMS_LIST" });
    Server.post("albums/user/edit/", { title, photos: image_hashes })
      .then(response => {
        const data = UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "CREATE_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        dispatch(fetchUserAlbumsList());
        showNotification({
          message: i18n.t("toasts.createnewalbum", {
            numberOfPhotos: image_hashes.length,
            title,
          }),
          title: i18n.t("toasts.createalbumtitle"),
          color: "teal",
          // status: "success",
        });
      })
      .catch(err => {
        dispatch({ type: "CREATE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function renameUserAlbum(albumID: string, albumTitle: string, newAlbumTitle: string) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "RENAME_USER_ALBUM" });
    Server.patch(`/albums/user/edit/${albumID}/`, {
      title: newAlbumTitle,
    })
      .then(() => {
        dispatch({ type: "RENAME_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        showNotification({
          message: i18n.t("toasts.renamealbum", { albumTitle, newAlbumTitle }),
          title: i18n.t("toasts.renamealbumtitle"),
          color: "teal",
          // To-Do: Add Icon
        });
      })
      .catch(err => {
        dispatch({ type: "RENAME_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function deleteUserAlbum(albumID: string, albumTitle: string) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "DELETE_USER_ALBUM" });
    Server.delete(`/albums/user/${albumID}`)
      .then(() => {
        dispatch({ type: "DELETE_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        showNotification({
          message: i18n.t("toasts.deletealbum", { albumTitle }),
          title: i18n.t("toasts.deletealbumtitle"),
          color: "teal",
        });
      })
      .catch(err => {
        dispatch({ type: "DELETE_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function removeFromUserAlbum(album_id: number, title: string, image_hashes: string[]) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "REMOVE_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      removedPhotos: image_hashes,
    })
      .then(response => {
        const data = UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "REMOVE_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        showNotification({
          message: i18n.t("toasts.removefromalbum", {
            numberOfPhotos: image_hashes.length,
            title,
          }),
          title: i18n.t("toasts.removefromalbumtitle"),
          color: "teal",
        });

        dispatch(fetchUserAlbumsList());
        dispatch(fetchUserAlbum(album_id));
      })
      .catch(err => {
        dispatch({ type: "REMOVE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function setAlbumCoverForUserAlbum(album_id, photo_hash) {
  return function cb(dispatch) {
    dispatch({ type: "SET_ALBUM_COVER_FOR_USER_ALBUM" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      cover_photo: photo_hash,
    })
      .then(() => {
        // To-Do: I should do something with the response
        dispatch({ type: "SET_ALBUM_COVER_FOR_USER_ALBUM_FULFILLED" });
        showNotification({
          message: i18n.t("toasts.setcoverphoto"),
          title: i18n.t("toasts.setcoverphototitle"),
          color: "teal",
        });
        dispatch(fetchUserAlbumsList());
      })
      .catch(err => {
        dispatch({ type: "SET_ALBUM_COVER_FOR_PERSON_REJECTED", payload: err });
      });
  };
}

export function addToUserAlbum(album_id: number, title: string, image_hashes: string[]) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "EDIT_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      title,
      photos: image_hashes,
    })
      .then(response => {
        const data = UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "EDIT_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        showNotification({
          message: i18n.t("toasts.addtoalbum", {
            numberOfPhotos: image_hashes.length,
            title,
          }),
          title: i18n.t("toasts.addtoalbumtitle"),
          color: "teal",
        });

        dispatch(fetchUserAlbumsList());
      })
      .catch(err => {
        dispatch({ type: "EDIT_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchPlaceAlbumsList() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS_LIST" });
    Server.get("albums/place/list/")
      .then(response => {
        const data = FetchPlaceAlbumsListResponseSchema.parse(response.data);
        const placeAlbumInfoList: PlaceAlbumInfo[] = data.results;
        const byGeolocationLevel = _.groupBy(placeAlbumInfoList, el => el.geolocation_level);
        dispatch({
          type: "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL",
          payload: byGeolocationLevel,
        });
        dispatch({
          type: "FETCH_PLACE_ALBUMS_LIST_FULFILLED",
          payload: placeAlbumInfoList,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

const PlaceAlbumResponseSchema = z.object({ results: PlaceAlbumSchema });

export function fetchPlaceAlbum(album_id: string) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS" });
    Server.get(`albums/place/${album_id}/`)
      .then(response => {
        const data = PlaceAlbumResponseSchema.parse(response.data);
        dispatch({
          type: "FETCH_PLACE_ALBUMS_FULFILLED",
          payload: data,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchAutoAlbumsList() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_LIST" });
    Server.get("albums/auto/list/")
      .then(response => {
        const data = FetchAutoAlbumsListResponseSchema.parse(response.data);
        const autoAlbumsList: AutoAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_AUTO_ALBUMS_LIST_FULFILLED",
          payload: autoAlbumsList,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

type AlbumDateListOptions = {
  photosetType: PhotosetType;
  person_id?: number;
  username?: string;
};

export function fetchAlbumDateList(dispatch: AppDispatch, options: AlbumDateListOptions) {
  dispatch({
    type: "FETCH_DATE_ALBUMS_LIST",
  });

  const favorites = options.photosetType === PhotosetType.FAVORITES ? "?favorite=true" : "";
  const publicParam = options.photosetType === PhotosetType.PUBLIC ? "?public=true" : "";
  const hiddenParam = options.photosetType === PhotosetType.HIDDEN ? "?hidden=true" : "";
  const photos = options.photosetType === PhotosetType.PHOTOS ? "?photo=true" : "";
  const deletedParam = options.photosetType === PhotosetType.DELETED ? "?deleted=true" : "";
  const usernameParam = options.username ? `&username=${options.username.toLowerCase()}` : "";
  const personidParam = options.person_id ? `?person=${options.person_id}` : "";
  const videos = options.photosetType === PhotosetType.VIDEOS ? "?video=true" : "";
  Server.get(
    `albums/date/list/${favorites}${publicParam}${hiddenParam}${deletedParam}${usernameParam}${personidParam}${photos}${videos}`,
    {
      timeout: 100000,
    }
  )
    .then(response => {
      const data = FetchDateAlbumsListResponseSchema.parse(response.data);
      const photosGroupedByDate: IncompleteDatePhotosGroup[] = data.results;
      addTempElementsToGroups(photosGroupedByDate);
      dispatch({
        type: "FETCH_DATE_ALBUMS_LIST_FULFILLED",
        payload: {
          photosGroupedByDate,
          photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
          photosetType: options.photosetType,
        },
      });
    })
    .catch(err => {
      dispatch({ type: "FETCH_DATE_ALBUMS_LIST_REJECTED", payload: err });
    });
}

type AlbumDateOption = {
  photosetType: PhotosetType;
  album_date_id: string;
  page: number;
  username?: string;
  person_id?: number;
};

export function fetchAlbumDate(dispatch: AppDispatch, options: AlbumDateOption) {
  dispatch({
    type: "FETCH_DATE_ALBUMS_RETRIEVE",
    payload: {
      album_id: options.album_date_id,
    },
  });
  const favorites = options.photosetType === PhotosetType.FAVORITES ? "&favorite=true" : "";
  const photos = options.photosetType === PhotosetType.PHOTOS ? "&photo=true" : "";
  const videos = options.photosetType === PhotosetType.VIDEOS ? "&video=true" : "";
  const publicParam = options.photosetType === PhotosetType.PUBLIC ? "&public=true" : "";
  const usernameParam = options.username ? `&username=${options.username.toLowerCase()}` : "";
  const personidParam = options.person_id ? `&person=${options.person_id}` : "";
  const deletedParam = options.photosetType === PhotosetType.DELETED ? "&deleted=true" : "";
  const hiddenParam = options.photosetType === PhotosetType.HIDDEN ? "&hidden=true" : "";
  Server.get(
    `albums/date/${options.album_date_id}/?page=${options.page}${favorites}${publicParam}${usernameParam}${personidParam}${deletedParam}${hiddenParam}${photos}${videos}`
  )
    .then(response => {
      const datePhotosGroup: IncompleteDatePhotosGroup = IncompleteDatePhotosGroupSchema.parse(response.data.results);
      dispatch({
        type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
        payload: {
          datePhotosGroup,
          page: options.page,
        },
      });
    })
    .catch(err => {
      dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", payload: err });
    });
}

// actions using new retrieve view in backend
export function fetchAlbumsAutoGalleries(dispatch: AppDispatch, album_id: string) {
  dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE" });
  Server.get(`albums/auto/${album_id}/`)
    .then(response => {
      const autoAlbum: AutoAlbum = AutoAlbumSchema.parse(response.data);
      dispatch({
        type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED",
        payload: autoAlbum,
      });
    })
    .catch(err => {
      dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
    });
}

export function deleteAutoAlbum(albumID: string, albumTitle: string) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "DELETE_AUTO_ALBUM" });
    Server.delete(`/albums/auto/${albumID}`)
      .then(() => {
        dispatch({ type: "DELETE_AUTO_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchAutoAlbumsList());
        showNotification({
          message: i18n.t("toasts.deletealbum", { albumTitle }),
          title: i18n.t("toasts.deletealbumtitle"),
          color: "teal",
        });
      })
      .catch(err => {
        dispatch({ type: "DELETE_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function deleteAllAutoAlbum() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "DELETE_All_AUTO_ALBUM" });
    Server.post(`/albums/auto/delete_all/`)
      .then(() => {
        dispatch({ type: "DELETE_ALL_AUTO_ALBUM_FULFILLED" });
        dispatch(fetchAutoAlbumsList());
        showNotification({
          message: i18n.t("toasts.deleteallautoalbums"),
          title: i18n.t("toasts.deleteallautoalbumstitle"),
          color: "teal",
        });
      })
      .catch(err => {
        dispatch({ type: "DELETE_ALL_AUTO_ALBUM_REJECTED", payload: err });
      });
  };
}

// share user album
export function setUserAlbumShared(album_id: number, target_user_id: string, val_shared: boolean) {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", { shared: val_shared, album_id, target_user_id })
      .then(response => {
        const userAlbumInfo: UserAlbumInfo = UserAlbumInfoSchema.parse(response.data);
        dispatch({
          type: "SET_ALBUM_USER_SHARED_FULFILLED",
          payload: userAlbumInfo,
        });
        dispatch(fetchUserAlbum(album_id));

        if (val_shared) {
          showNotification({
            message: i18n.t("toasts.sharingalbum"),
            title: i18n.t("toasts.sharingalbumtitle"),
            color: "teal",
          });
        } else {
          showNotification({
            message: i18n.t("toasts.unsharingalbum"),
            title: i18n.t("toasts.unsharingalbumtitle"),
            color: "teal",
          });
        }
      })
      .catch(err => {
        dispatch({ type: "SET_ALBUM_USER_SHARED_FULFILLED", payload: err });
      });
  };
}

export function fetchUserAlbumsSharedToMe() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME" });
    Server.get("/albums/user/shared/tome/")
      .then(response => {
        const data = FetchUserAlbumsSharedResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        const sharedAlbumsGroupedByOwner = _.toPairs(_.groupBy(userAlbumInfoList, "owner.id")).map(el => ({
          user_id: parseInt(el[0], 10),
          albums: el[1],
        }));
        dispatch({
          type: "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED",
          payload: sharedAlbumsGroupedByOwner,
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsSharedFromMe() {
  return function cb(dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_FROM_ME" });
    Server.get("/albums/user/shared/fromme/")
      .then(response => {
        const data = FetchUserAlbumsSharedResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED",
          payload: userAlbumInfoList,
        });
      })
      .catch(err => {
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_REJECTED",
          payload: err,
        });
      });
  };
}
