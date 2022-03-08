import { Server } from "../api_client/apiClient";
import _ from "lodash";
import { PhotosetType } from "../reducers/photosReducer";
import { notify } from "reapop";

import { push } from "connected-react-router";
import {
  adjustDateFormat,
  adjustDateFormatForSingleGroup,
  getPhotosFlatFromGroupedByDate,
  addTempElementsToGroups,
} from "../util/util";
import type { Dispatch } from "react";
import type { DatePhotosGroup, IncompleteDatePhotosGroup } from "./photosActions.types";
import { IncompleteDatePhotosGroupSchema, PersonInfo } from "./photosActions.types";
import type {
  AlbumInfo,
  ThingAlbum,
  UserAlbumInfo,
  UserAlbumDetails,
  PlaceAlbumInfo,
  AutoAlbumInfo,
  AutoAlbum,
} from "./albumActions.types";
import {
  _FetchThingAlbumsListResponseSchema,
  _FetchThingAlbumResponseSchema,
  _FetchUserAlbumsListResponseSchema,
  UserAlbumSchema,
  _UserAlbumEditResponseSchema,
  _FetchPlaceAlbumsListResponseSchema,
  PlaceAlbumSchema,
  _FetchAutoAlbumsListResponseSchema,
  _FetchUserAlbumsSharedResponseSchema,
  _FetchDateAlbumsListResponseSchema,
  AutoAlbumSchema,
  UserAlbumInfoSchema,
} from "./albumActions.types";
import { z } from "zod";
import type { AppDispatch } from "../store";
import i18n from "../i18n";

export function fetchThingAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS_LIST" });
    Server.get("albums/thing/list/")
      .then((response) => {
        const data = _FetchThingAlbumsListResponseSchema.parse(response.data);
        const albumInfoList: AlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_THING_ALBUMS_LIST_FULFILLED",
          payload: albumInfoList,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_THING_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchThingAlbum(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS" });
    Server.get(`albums/thing/${album_id}/`)
      .then((response) => {
        const data = _FetchThingAlbumResponseSchema.parse(response.data);
        const thingAlbum: ThingAlbum = data.results;
        dispatch({
          type: "FETCH_THING_ALBUMS_FULFILLED",
          payload: thingAlbum,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_THING_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_USER_ALBUMS_LIST" });
    Server.get("albums/user/list/")
      .then((response) => {
        const data = _FetchUserAlbumsListResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_USER_ALBUMS_LIST_FULFILLED",
          payload: userAlbumInfoList,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export const FETCH_USER_ALBUM = "FETCH_USER_ALBUM";
export const FETCH_USER_ALBUM_FULFILLED = "FETCH_USER_ALBUM_FULFILLED";
export const FETCH_USER_ALBUM_REJECTED = "FETCH_USER_ALBUM_REJECTED";
export function fetchUserAlbum(album_id: number) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_USER_ALBUM });
    Server.get(`albums/user/${album_id}/`)
      .then((response) => {
        const data = UserAlbumSchema.parse(response.data);
        const photosGroupedByDate: DatePhotosGroup[] = data.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        const albumDetails: UserAlbumDetails = data;
        dispatch({
          type: FETCH_USER_ALBUM_FULFILLED,
          payload: {
            photosGroupedByDate: photosGroupedByDate,
            photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
            albumDetails: albumDetails,
          },
        });
      })
      .catch((err) => {
        dispatch({ type: FETCH_USER_ALBUM_REJECTED, payload: err });
      });
  };
}

export function createNewUserAlbum(title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "CREATE_USER_ALBUMS_LIST" });
    Server.post("albums/user/edit/", { title: title, photos: image_hashes })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "CREATE_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify(
            i18n.t("toasts.createnewalbum", {
              numberOfPhotos: image_hashes.length,
              title: title,
            }),
            {
              title: i18n.t("toasts.createalbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
              buttons: [
                {
                  name: i18n.t("toasts.viewalbum"),
                  primary: true,
                  onClick: () => {
                    dispatch(fetchUserAlbum(data.id));
                    dispatch(push(`/useralbum/${data.id}/`));
                  },
                },
              ],
            }
          )
        );
      })
      .catch((err) => {
        dispatch({ type: "CREATE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function renameUserAlbum(albumID: string, albumTitle: string, newAlbumTitle: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "RENAME_USER_ALBUM" });
    Server.patch(`/albums/user/edit/${albumID}/`, {
      title: newAlbumTitle,
    })
      .then((response) => {
        dispatch({ type: "RENAME_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify(
            i18n.t("toasts.renamealbum", {
              albumTitle: albumTitle,
              newAlbumTitle: newAlbumTitle,
            }),
            {
              title: i18n.t("toasts.renamealbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
            }
          )
        );
      })
      .catch((err) => {
        dispatch({ type: "RENAME_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function deleteUserAlbum(albumID: string, albumTitle: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "DELETE_USER_ALBUM" });
    Server.delete(`/albums/user/${albumID}`)
      .then((response) => {
        dispatch({ type: "DELETE_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify(
            i18n.t("toasts.deletealbum", {
              albumTitle: albumTitle,
            }),
            {
              title: i18n.t("toasts.deletealbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
            }
          )
        );
      })
      .catch((err) => {
        dispatch({ type: "DELETE_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function removeFromUserAlbum(album_id: number, title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "REMOVE_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      removedPhotos: image_hashes,
    })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "REMOVE_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        dispatch(
          notify(
            i18n.t("toasts.removefromalbum", {
              numberOfPhotos: image_hashes.length,
              title: title,
            }),
            {
              title: i18n.t("toasts.removefromalbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
            }
          )
        );
        dispatch(fetchUserAlbumsList());
        dispatch(fetchUserAlbum(album_id));
      })
      .catch((err) => {
        dispatch({ type: "REMOVE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function addToUserAlbum(album_id: number, title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "EDIT_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      title: title,
      photos: image_hashes,
    })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.parse(response.data);
        dispatch({
          type: "EDIT_USER_ALBUMS_LIST_FULFILLED",
          payload: data,
        });
        dispatch(
          notify(
            i18n.t("toasts.addtoalbum", {
              numberOfPhotos: image_hashes.length,
              title: title,
            }),
            {
              title: i18n.t("toasts.addtoalbumtitle"),

              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
              buttons: [
                {
                  name: "View Album",
                  primary: true,
                  onClick: () => {
                    dispatch(fetchUserAlbum(album_id));
                    dispatch(push(`/useralbum/${album_id}/`));
                  },
                },
              ],
            }
          )
        );
        dispatch(fetchUserAlbumsList());
      })
      .catch((err) => {
        dispatch({ type: "EDIT_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchPlaceAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS_LIST" });
    Server.get("albums/place/list/")
      .then((response) => {
        const data = _FetchPlaceAlbumsListResponseSchema.parse(response.data);
        const placeAlbumInfoList: PlaceAlbumInfo[] = data.results;
        const byGeolocationLevel = _.groupBy(placeAlbumInfoList, (el) => el.geolocation_level);
        dispatch({
          type: "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL",
          payload: byGeolocationLevel,
        });
        dispatch({
          type: "FETCH_PLACE_ALBUMS_LIST_FULFILLED",
          payload: placeAlbumInfoList,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

const PlaceAlbumResponseSchema = z.object({ results: PlaceAlbumSchema });
export function fetchPlaceAlbum(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS" });
    Server.get(`albums/place/${album_id}/`)
      .then((response) => {
        const data = PlaceAlbumResponseSchema.parse(response.data);
        dispatch({
          type: "FETCH_PLACE_ALBUMS_FULFILLED",
          payload: data,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchAutoAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_LIST" });
    Server.get("albums/auto/list/")
      .then((response) => {
        const data = _FetchAutoAlbumsListResponseSchema.parse(response.data);
        const autoAlbumsList: AutoAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_AUTO_ALBUMS_LIST_FULFILLED",
          payload: autoAlbumsList,
        });
      })
      .catch((err) => {
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

  const deletedParam = options.photosetType === PhotosetType.DELETED ? "?deleted=true" : "";
  const usernameParam = options.username ? `&username=${options.username.toLowerCase()}` : "";
  const personidParam = options.person_id ? `?person=${options.person_id}` : "";
  Server.get("albums/date/list/" + favorites + publicParam + deletedParam + usernameParam + personidParam, {
    timeout: 100000,
  })
    .then((response) => {
      const data = _FetchDateAlbumsListResponseSchema.parse(response.data);
      const photosGroupedByDate: IncompleteDatePhotosGroup[] = data.results;
      adjustDateFormat(photosGroupedByDate);
      addTempElementsToGroups(photosGroupedByDate);
      dispatch({
        type: "FETCH_DATE_ALBUMS_LIST_FULFILLED",
        payload: {
          photosGroupedByDate: photosGroupedByDate,
          photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
          photosetType: options.photosetType,
        },
      });
    })
    .catch((err) => {
      console.log(err);
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
  const publicParam = options.photosetType === PhotosetType.PUBLIC ? "&public=true" : "";
  const usernameParam = options.username ? `&username=${options.username.toLowerCase()}` : "";
  const personidParam = options.person_id ? `&person=${options.person_id}` : "";
  const deletedParam = options.photosetType === PhotosetType.DELETED ? "&deleted=true" : "";
  Server.get(
    `albums/date/${options.album_date_id}/?page=${options.page}` +
      favorites +
      publicParam +
      usernameParam +
      personidParam +
      deletedParam
  )
    .then((response) => {
      const datePhotosGroup: IncompleteDatePhotosGroup = IncompleteDatePhotosGroupSchema.parse(response.data.results);
      adjustDateFormatForSingleGroup(datePhotosGroup);
      dispatch({
        type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
        payload: {
          datePhotosGroup: datePhotosGroup,
          page: options.page,
        },
      });
    })
    .catch((err) => {
      console.log(err);
      dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", payload: err });
    });
}

//actions using new retrieve view in backend
export function fetchAlbumsAutoGalleries(dispatch: AppDispatch, album_id: string) {
  dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE" });
  Server.get(`albums/auto/${album_id}/`)
    .then((response) => {
      const autoAlbum: AutoAlbum = AutoAlbumSchema.parse(response.data);
      dispatch({
        type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED",
        payload: autoAlbum,
      });
    })
    .catch((err) => {
      console.log(err);
      dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
    });
}

// share user album
export function setUserAlbumShared(album_id: number, target_user_id: string, val_shared: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", {
      shared: val_shared,
      album_id: album_id,
      target_user_id: target_user_id,
    })
      .then((response) => {
        const userAlbumInfo: UserAlbumInfo = UserAlbumInfoSchema.parse(response.data);
        dispatch({
          type: "SET_ALBUM_USER_SHARED_FULFILLED",
          payload: userAlbumInfo,
        });
        dispatch(fetchUserAlbum(album_id));

        if (val_shared) {
          dispatch(
            notify(i18n.t("toasts.sharingalbum"), {
              title: i18n.t("toasts.sharingalbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
            })
          );
        } else {
          dispatch(
            notify(i18n.t("toasts.unsharingalbum"), {
              title: i18n.t("toasts.unsharingalbumtitle"),
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "bottom-right",
            })
          );
        }
      })
      .catch((err) => {
        dispatch({ type: "SET_ALBUM_USER_SHARED_FULFILLED", payload: err });
        console.log(err.content);
      });
  };
}

export function fetchUserAlbumsSharedToMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME" });
    Server.get("/albums/user/shared/tome/")
      .then((response) => {
        const data = _FetchUserAlbumsSharedResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        const sharedAlbumsGroupedByOwner = _.toPairs(_.groupBy(userAlbumInfoList, "owner.id")).map((el) => {
          return { user_id: parseInt(el[0], 10), albums: el[1] };
        });
        dispatch({
          type: "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED",
          payload: sharedAlbumsGroupedByOwner,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsSharedFromMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_FROM_ME" });
    Server.get("/albums/user/shared/fromme/")
      .then((response) => {
        const data = _FetchUserAlbumsSharedResponseSchema.parse(response.data);
        const userAlbumInfoList: UserAlbumInfo[] = data.results;
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED",
          payload: userAlbumInfoList,
        });
      })
      .catch((err) => {
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_REJECTED",
          payload: err,
        });
      });
  };
}
