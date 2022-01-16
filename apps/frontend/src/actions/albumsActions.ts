import { Server } from "../api_client/apiClient";
import _ from "lodash";
import { PhotosetType } from "../reducers/photosReducer";
const reapop = require("reapop");
const notify = reapop.notify;
import { push } from "connected-react-router";
import {
  adjustDateFormat,
  adjustDateFormatForSingleGroup,
  getPhotosFlatFromGroupedByDate,
  addTempElementsToGroups,
} from "../util/util";
import { Dispatch } from "react";
import {
  DatePhotosGroup,
  IncompleteDatePhotosGroup,
  IncompleteDatePhotosGroupSchema,
  PersonInfo,
} from "./photosActions.types";
import {
  _FetchThingAlbumsListResponseSchema,
  AlbumInfo,
  _FetchThingAlbumResponseSchema,
  ThingAlbum,
  _FetchUserAlbumsListResponseSchema,
  UserAlbumInfo,
  UserAlbumSchema,
  UserAlbumDetails,
  _UserAlbumEditResponseSchema,
  _FetchPlaceAlbumsListResponseSchema,
  PlaceAlbumInfo,
  PlaceAlbumSchema,
  AutoAlbumInfo,
  _FetchAutoAlbumsListResponseSchema,
  _FetchUserAlbumsSharedResponseSchema,
  _FetchPersonPhotosResponseSchema,
  _FetchDateAlbumsListResponseSchema,
  AutoAlbumSchema,
  UserAlbumInfoSchema,
  AutoAlbum,
} from "./albumActions.types";
import { z } from "zod";
import { AppDispatch } from "../store";

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
        var photosGroupedByDate: DatePhotosGroup[] = data.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var albumDetails: UserAlbumDetails = data;
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
          notify({
            message: `${image_hashes.length} photo(s) were successfully added to new album "${title}"`,
            title: "Create album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
            buttons: [
              {
                name: "View Album",
                primary: true,
                onClick: () => {
                  dispatch(fetchUserAlbum(data.id));
                  dispatch(push(`/useralbum/${data.id}/`));
                },
              },
            ],
          })
        );
      })
      .catch((err) => {
        dispatch({ type: "CREATE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function renameUserAlbum(
  albumID: string,
  albumTitle: string,
  newAlbumTitle: string
) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "RENAME_USER_ALBUM" });
    Server.patch(`/albums/user/edit/${albumID}/`, {
      title: newAlbumTitle,
    })
      .then((response) => {
        dispatch({ type: "RENAME_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify({
            message: `${albumTitle} was successfully renamed to ${newAlbumTitle}.`,
            title: "Rename album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
          })
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
          notify({
            message: `${albumTitle} was successfully deleted.`,
            title: "Delete album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
          })
        );
      })
      .catch((err) => {
        dispatch({ type: "DELETE_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function removeFromUserAlbum(
  album_id: number,
  title: string,
  image_hashes: string[]
) {
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
          notify({
            message: `${image_hashes.length} photo(s) were successfully removed from album "${title}"`,
            title: "Removed from album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
          })
        );
        dispatch(fetchUserAlbumsList());
        dispatch(fetchUserAlbum(album_id));
      })
      .catch((err) => {
        dispatch({ type: "REMOVE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function addToUserAlbum(
  album_id: number,
  title: string,
  image_hashes: string[]
) {
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
          notify({
            message: `${image_hashes.length} photo(s) were successfully added to existing album "${title}"`,
            title: "Add to album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
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
          })
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
        var byGeolocationLevel = _.groupBy(
          placeAlbumInfoList,
          (el) => el.geolocation_level
        );
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

export const FETCH_PERSON_PHOTOS = "FETCH_PERSON_PHOTOS";
export const FETCH_PERSON_PHOTOS_FULFILLED = "FETCH_PERSON_PHOTOS_FULFILLED";
export const FETCH_PERSON_PHOTOS_REJECTED = "FETCH_PERSON_PHOTOS_REJECTED";
export function fetchPersonPhotos(person_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PERSON_PHOTOS });
    Server.get(`albums/person/${person_id}/`)
      .then((response) => {
        const data = _FetchPersonPhotosResponseSchema.parse(response.data);
        var photosGroupedByDate: DatePhotosGroup[] =
          data.results.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var personDetails: PersonInfo = data.results;
        dispatch({
          type: FETCH_PERSON_PHOTOS_FULFILLED,
          payload: {
            photosGroupedByDate: photosGroupedByDate,
            photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
            personDetails: personDetails,
          },
        });
      })
      .catch((err) => {
        dispatch({ type: FETCH_PERSON_PHOTOS_REJECTED, payload: err });
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

export function fetchAlbumDateList(
  dispatch: AppDispatch,
  options: AlbumDateListOptions
) {
  dispatch({
    type: "FETCH_DATE_ALBUMS_LIST",
  });

  var favorites =
    options.photosetType === PhotosetType.FAVORITES ? `?favorite=true` : "";
  var publicParam =
    options.photosetType === PhotosetType.PUBLIC ? `?public=true` : "";
  var usernameParam = options.username
    ? `&username=${options.username.toLowerCase()}`
    : "";
  var personidParam = options.person_id ? `?person=${options.person_id}` : "";
  Server.get(
    "albums/date/list/" +
      favorites +
      publicParam +
      usernameParam +
      personidParam,
    {
      timeout: 100000,
    }
  )
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

export function fetchAlbumDate(
  dispatch: AppDispatch,
  options: AlbumDateOption
) {
  dispatch({
    type: "FETCH_DATE_ALBUMS_RETRIEVE",
    payload: {
      album_id: options.album_date_id,
    },
  });
  var favorites =
    options.photosetType === PhotosetType.FAVORITES ? `&favorite=true` : "";
  var publicParam =
    options.photosetType === PhotosetType.PUBLIC ? `&public=true` : "";
  var usernameParam = options.username
    ? `&username=${options.username.toLowerCase()}`
    : "";
  var personidParam = options.person_id ? `&person=${options.person_id}` : "";
  Server.get(
    `albums/date/${options.album_date_id}/?page=${options.page}` +
      favorites +
      publicParam +
      usernameParam +
      personidParam
  )
    .then((response) => {
      console.log(response.data);
      const datePhotosGroup: IncompleteDatePhotosGroup =
        IncompleteDatePhotosGroupSchema.parse(response.data.results);
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
export function fetchAlbumsAutoGalleries(
  dispatch: AppDispatch,
  album_id: string
) {
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
      dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
    });
}

// share user album
export function setUserAlbumShared(
  album_id: number,
  target_user_id: string,
  val_shared: boolean
) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", {
      shared: val_shared,
      album_id: album_id,
      target_user_id: target_user_id,
    })
      .then((response) => {
        const userAlbumInfo: UserAlbumInfo = UserAlbumInfoSchema.parse(
          response.data
        );
        dispatch({
          type: "SET_ALBUM_USER_SHARED_FULFILLED",
          payload: userAlbumInfo,
        });
        dispatch(fetchUserAlbum(album_id));

        if (val_shared) {
          dispatch(
            notify({
              message: `Album was successfully shared`,
              title: "Share album",
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "br",
            })
          );
        } else {
          dispatch(
            notify({
              message: `Album was successfully unshared`,
              title: "Unshare album",
              status: "success",
              dismissible: true,
              dismissAfter: 3000,
              position: "br",
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
        const sharedAlbumsGroupedByOwner = _.toPairs(
          _.groupBy(userAlbumInfoList, "owner.id")
        ).map((el) => {
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
