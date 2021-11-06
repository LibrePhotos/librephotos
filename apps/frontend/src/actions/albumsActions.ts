import { Server } from "../api_client/apiClient";
import _ from "lodash";
const reapop = require("reapop");
const notify = reapop.notify;
import { push } from "react-router-redux";
import {
  adjustDateFormat,
  adjustDateFormatForSingleGroup,
  getPhotosFlatFromGroupedByDate,
  addTempElementsToGroups,
} from "../util/util";
import { Dispatch } from "react";
import { AxiosResponse } from "axios";
import { DatePhotosGroup, DatePhotosGroupSchema, IncompleteDatePhotosGroup, IncompleteDatePhotosGroupSchema, PersonInfo, PersonInfoSchema, PhotoHashSchema, SimpleUserSchema } from "./photosActions.types";
import * as Yup from "yup";

const AlbumInfoSchema = Yup.object({
  id: Yup.number().required(),
  title: Yup.string(),
  cover_photos: Yup.array().of(PhotoHashSchema).required(),
  photo_count: Yup.number().required(),
})
interface AlbumInfo extends Yup.Asserts<typeof AlbumInfoSchema> { }

const ThingAlbumSchema = Yup.object({
  id: Yup.number().required(),
  title: Yup.string().required(),
  grouped_photos: Yup.array().of(DatePhotosGroupSchema).required(),
})
interface ThingAlbum extends Yup.Asserts<typeof ThingAlbumSchema> {}

const UserAlbumInfoSchema = AlbumInfoSchema.shape({ // UserAlbumInfo extends AlbumInfo
  owner: SimpleUserSchema.required(),
  shared_to: Yup.array().of(SimpleUserSchema).required(),
  created_on: Yup.string().required(),
  favorited: Yup.boolean().required(),
})
interface UserAlbumInfo extends Yup.Asserts<typeof UserAlbumInfoSchema> { }

const UserAlbumDetailsSchema = Yup.object({
  id: Yup.string().required(),
  title: Yup.string(),
  owner: SimpleUserSchema.required(),
  shared_to: Yup.array().of(SimpleUserSchema).required(),

  date: Yup.string().required(),
  location: Yup.string().nullable(),
})
interface UserAlbumDetails extends Yup.Asserts<typeof UserAlbumDetailsSchema> { }

const UserAlbumSchema = UserAlbumDetailsSchema.shape({
  grouped_photos: Yup.array().of(DatePhotosGroupSchema).required(),
})

const _FetchThingAlbumsListResponseSchema = Yup.object({ results: Yup.array().of(AlbumInfoSchema).required() })
export function fetchThingAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS_LIST" });
    Server.get("albums/thing/list/")
      .then((response) => {
        const data = _FetchThingAlbumsListResponseSchema.validateSync(response.data);
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

const _FetchThingAlbumResponseSchema = Yup.object({ results: ThingAlbumSchema.required() })
export function fetchThingAlbum(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_THING_ALBUMS" });
    Server.get(`albums/thing/${album_id}/`)
      .then((response) => {
        const data = _FetchThingAlbumResponseSchema.validateSync(response.data);
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

const _FetchUserAlbumsListResponseSchema = Yup.object({ results: Yup.array().of(UserAlbumInfoSchema).required() })
export function fetchUserAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_USER_ALBUMS_LIST" });
    Server.get("albums/user/list/")
      .then((response) => {
        const data = _FetchUserAlbumsListResponseSchema.validateSync(response.data);
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
export function fetchUserAlbum(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_USER_ALBUM });
    Server.get(`albums/user/${album_id}/`)
      .then((response) => {
        const data = UserAlbumSchema.validateSync(response.data);
        var photosGroupedByDate: DatePhotosGroup[] = data.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var albumDetails = data as UserAlbumDetails;
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

const _UserAlbumEditResponseSchema = Yup.object({
  id: Yup.string().required(),
  title: Yup.string().nullable(),
  photos: Yup.array().of(Yup.string()).required(),
  created_on: Yup.string().required(),
  favorited: Yup.boolean().required(),
  removedPhotos: Yup.array().of(Yup.string()),
})
export function createNewUserAlbum(title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "CREATE_USER_ALBUMS_LIST" });
    Server.post("albums/user/edit/", { title: title, photos: image_hashes })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.validateSync(response.data);
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

export function removeFromUserAlbum(album_id: string, title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "REMOVE_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      removedPhotos: image_hashes,
    })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.validateSync(response.data);
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

export function addToUserAlbum(album_id: string, title: string, image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "EDIT_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      title: title,
      photos: image_hashes,
    })
      .then((response) => {
        const data = _UserAlbumEditResponseSchema.validateSync(response.data);
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

const PlaceAlbumInfoSchema = AlbumInfoSchema.shape({
  geolocation_level: Yup.number().required(),
})
interface PlaceAlbumInfo extends Yup.Asserts<typeof PlaceAlbumInfoSchema> { }
const _FetchPlaceAlbumsListResponseSchema = Yup.object({ results: Yup.array().of(PlaceAlbumInfoSchema).required() })
export function fetchPlaceAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS_LIST" });
    Server.get("albums/place/list/")
      .then((response) => {
        const data = _FetchPlaceAlbumsListResponseSchema.validateSync(response.data);
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

export function fetchPlaceAlbum(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PLACE_ALBUMS" });
    Server.get(`albums/place/${album_id}/`)
      .then((response) => {
        const data = PlaceAlbumInfoSchema.validateSync(response.data)
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

const PersonPhotosSchema = PersonInfoSchema.shape({
  grouped_photos: Yup.array().of(DatePhotosGroupSchema).required(),
})
const _FetchPersonPhotosResponseSchema = Yup.object({ results: PersonPhotosSchema.required() })
export const FETCH_PERSON_PHOTOS = "FETCH_PERSON_PHOTOS";
export const FETCH_PERSON_PHOTOS_FULFILLED = "FETCH_PERSON_PHOTOS_FULFILLED";
export const FETCH_PERSON_PHOTOS_REJECTED = "FETCH_PERSON_PHOTOS_REJECTED";
export function fetchPersonPhotos(person_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PERSON_PHOTOS });
    Server.get(`albums/person/${person_id}/`)
      .then((response) => {
        const data = _FetchPersonPhotosResponseSchema.validateSync(response.data)
        var photosGroupedByDate: DatePhotosGroup[] = data.results.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var personDetails = data.results as PersonInfo;
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

const PersonSchema = Yup.object({
  name: Yup.string().required(),
  face_url: Yup.string(),
  face_count: Yup.number().required(),
  face_photo_url: Yup.string(),
  id: Yup.string().required(),
  newPersonName: Yup.string(),
})
const PhotoSimpleSchema = Yup.object({
  square_thumbnail: Yup.string(),
  image: Yup.string(),
  image_hash: Yup.string().required(),
  exif_timestamp: Yup.string(),
  exif_gps_lat: Yup.number(),
  exif_gps_lon: Yup.number(),
  rating: Yup.number(),
  geolocation_json: Yup.string(),
  public: Yup.boolean(),
  video: Yup.boolean(),
})
const AutoAlbumSchema = Yup.object({
  id: Yup.string(),
  title: Yup.string(),
  favorited: Yup.boolean(),
  timestamp: Yup.string(),
  created_on: Yup.string(),
  gps_lat: Yup.number(),
  people: Yup.array().of(PersonSchema),
  gps_lon: Yup.number(),
  photos: Yup.array().of(PhotoSimpleSchema),
})
interface AutoAlbum extends Yup.Asserts<typeof AutoAlbumSchema> { }

//actions using new list view in backend

const _FetchAutoAlbumsListResponseSchema = Yup.object({results: Yup.array().of(AutoAlbumSchema).required()})
export function fetchAutoAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_LIST" });
    Server.get("albums/auto/list/")
      .then((response) => {
        const data = _FetchAutoAlbumsListResponseSchema.validateSync(response.data);
        const autoAlbumsList: AutoAlbum[] = data.results;
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

const _FetchDateAlbumsListResponseSchema = Yup.object({ results: Yup.array().of(IncompleteDatePhotosGroupSchema).required() })
export function fetchDateAlbumsList() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_DATE_ALBUMS_LIST" });
    Server.get("albums/date/list/", { timeout: 100000 })
      .then((response) => {
        const data = _FetchDateAlbumsListResponseSchema.validateSync(response.data);
        const photosGroupedByDate: IncompleteDatePhotosGroup[] = data.results;
        adjustDateFormat(photosGroupedByDate);
        addTempElementsToGroups(photosGroupedByDate);
        dispatch({
          type: "FETCH_DATE_ALBUMS_LIST_FULFILLED",
          payload: {
            photosGroupedByDate: photosGroupedByDate,
            photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
          },
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_DATE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

//actions using new retrieve view in backend
export function fetchAlbumsAutoGalleries(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE" });
    Server.get(`albums/auto/${album_id}/`)
      .then((response: AxiosResponse<AutoAlbum>) => {
        const autoAlbum: AutoAlbum = AutoAlbumSchema.validateSync(response.data);
        dispatch({
          type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED",
          payload: autoAlbum,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

export function fetchAlbumsDateGalleries(album_id: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({
      type: "FETCH_DATE_ALBUMS_RETRIEVE",
      payload: {
        album_id: album_id,
      },
    });
    Server.get(`albums/date/${album_id}/`)
      .then((response) => {
        const datePhotosGroup: IncompleteDatePhotosGroup = IncompleteDatePhotosGroupSchema.validateSync(response.data);
        adjustDateFormatForSingleGroup(datePhotosGroup);
        dispatch({
          type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
          payload: {
            datePhotosGroup: datePhotosGroup,
          },
        });
      })
      .catch((err) => {
        console.log(err);
        dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

// share user album
export function setUserAlbumShared(album_id: string, target_user_id: string, val_shared: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", {
      shared: val_shared,
      album_id: album_id,
      target_user_id: target_user_id,
    })
      .then((response) => {
        const userAlbumInfo: UserAlbumInfo = UserAlbumInfoSchema.validateSync(response.data);
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

//sharing
const _FetchUserAlbumsSharedResponseSchema = Yup.object({results: Yup.array().of(UserAlbumInfoSchema).required()})
export function fetchUserAlbumsSharedToMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME" });
    Server.get("/albums/user/shared/tome/")
      .then((response) => {
        const data = _FetchUserAlbumsSharedResponseSchema.validateSync(response.data);
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
        const data = _FetchUserAlbumsSharedResponseSchema.validateSync(response.data);
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
