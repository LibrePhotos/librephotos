import { Server } from "../api_client/apiClient";
import _ from "lodash";
import { notify } from "reapop";
import { push } from "react-router-redux";
import {
  adjustDateFormat,
  adjustDateFormatForSingleGroup,
  getPhotosFlatFromGroupedByDate,
  getPhotosFlatFromSingleGroup,
  addTempElementsToGroups,
} from "../util/util";

export function fetchThingAlbumsList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_THING_ALBUMS_LIST" });
    Server.get("albums/thing/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_THING_ALBUMS_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_THING_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchThingAlbum(album_id) {
  return function (dispatch) {
    dispatch({ type: "FETCH_THING_ALBUMS" });
    Server.get(`albums/thing/${album_id}/`)
      .then((response) => {
        dispatch({
          type: "FETCH_THING_ALBUMS_FULFILLED",
          payload: response.data,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_THING_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_USER_ALBUMS_LIST" });
    Server.get("albums/user/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data.results,
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
export function fetchUserAlbum(album_id) {
  return function (dispatch) {
    dispatch({ type: FETCH_USER_ALBUM });
    Server.get(`albums/user/${album_id}/`)
      .then((response) => {
        var photosGroupedByDate = response.data.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var albumDetails = response.data;
        delete albumDetails.grouped_photos;
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

export function createNewUserAlbum(title, image_hashes) {
  return function (dispatch) {
    dispatch({ type: "CREATE_USER_ALBUMS_LIST" });
    Server.post("albums/user/edit/", { title: title, photos: image_hashes })
      .then((response) => {
        dispatch({
          type: "CREATE_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data,
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
                  dispatch(fetchUserAlbum(response.data.id));
                  dispatch(push(`/useralbum/${response.data.id}/`));
                  console.log(response.data.id);
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

export function renameUserAlbum(albumID, albumTitle, newAlbumTitle) {
  return function (dispatch) {
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

export function deleteUserAlbum(albumID, albumTitle) {
  return function (dispatch) {
    dispatch({ type: "DELTE_USER_ALBUM" });
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

export function editUserAlbum(album_id, title, image_hashes) {
  return function (dispatch) {
    dispatch({ type: "EDIT_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      title: title,
      photos: image_hashes,
    })
      .then((response) => {
        dispatch({
          type: "EDIT_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data,
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
  return function (dispatch) {
    dispatch({ type: "FETCH_PLACE_ALBUMS_LIST" });
    Server.get("albums/place/list/")
      .then((response) => {
        var byGeolocationLevel = _.groupBy(
          response.data.results,
          (el) => el.geolocation_level
        );
        dispatch({
          type: "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL",
          payload: byGeolocationLevel,
        });
        dispatch({
          type: "FETCH_PLACE_ALBUMS_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchPlaceAlbum(album_id) {
  return function (dispatch) {
    dispatch({ type: "FETCH_PLACE_ALBUMS" });
    Server.get(`albums/place/${album_id}/`)
      .then((response) => {
        dispatch({
          type: "FETCH_PLACE_ALBUMS_FULFILLED",
          payload: response.data,
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
export function fetchPersonPhotos(person_id) {
  return function (dispatch) {
    dispatch({ type: FETCH_PERSON_PHOTOS });
    Server.get(`albums/person/${person_id}/`)
      .then((response) => {
        var photosGroupedByDate = response.data.results.grouped_photos;
        adjustDateFormat(photosGroupedByDate);
        var personDetails = response.data.results;
        delete personDetails.grouped_photos;
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

export function generateAutoAlbums() {
  return function (dispatch) {
    dispatch({ type: "GENERATE_AUTO_ALBUMS" });
    Server.get("autoalbumgen/")
      .then((response) => {
        dispatch({
          type: "GENERATE_AUTO_ALBUMS_FULFILLED",
          payload: response.data,
        });
        dispatch(fetchAutoAlbums());
      })
      .catch((err) => {
        dispatch({ type: "GENERATE_AUTO_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchAutoAlbums() {
  return function (dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS" });
    Server.get("albums/auto/?page_size=50")
      .then((response) => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_REJECTED", payload: err });
      });
  };
}

//actions using new list view in backend

export function fetchAutoAlbumsList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_LIST" });
    Server.get("albums/auto/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchDateAlbumsList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_DATE_ALBUMS_LIST" });
    Server.get("albums/date/list/", { timeout: 100000 })
      .then((response) => {
        var photosGroupedByDate = response.data.results;
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
export function fetchAlbumsAutoGalleries(album_id) {
  return function (dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE" });
    Server.get(`albums/auto/${album_id}/`)
      .then((response) => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED",
          payload: response.data,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

export function fetchAlbumsDateGalleries(album_id) {
  return function (dispatch) {
    dispatch({
      type: "FETCH_DATE_ALBUMS_RETRIEVE",
      payload: {
        album_id: album_id,
      },
    });
    Server.get(`albums/date/${album_id}/`)
      .then((response) => {
        var photosGroupedByDate = response.data;
        adjustDateFormatForSingleGroup(photosGroupedByDate);
        dispatch({
          type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
          payload: {
            photosGroupedByDate: photosGroupedByDate,
            photosFlat: getPhotosFlatFromSingleGroup(photosGroupedByDate),
          },
        });
      })
      .catch((err) => {
        console.log(err);
        dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

export function toggleAlbumAutoFavorite(album_id, rating) {
  return function (dispatch) {
    dispatch({ type: "TOGGLE_ALBUM_AUTO_FAVORITE" });
    Server.patch(`albums/auto/list/${album_id}/`, { favorited: rating })
      .then((response) => {
        dispatch({
          type: "TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED",
          payload: response.data,
        });
      })
      .catch((err) => {
        dispatch({ type: "TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED", payload: err });
      });
  };
}

// share user album
export function setUserAlbumShared(album_id, target_user_id, val_shared) {
  return function (dispatch) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", {
      shared: val_shared,
      album_id: album_id,
      target_user_id: target_user_id,
    })
      .then((response) => {
        dispatch({
          type: "SET_ALBUM_USER_SHARED_FULFILLED",
          payload: response.data,
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
export function fetchUserAlbumsSharedToMe() {
  return function (dispatch) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME" });
    Server.get("/albums/user/shared/tome/")
      .then((response) => {
        const sharedAlbumssGroupedByOwner = _.toPairs(
          _.groupBy(response.data.results, "owner.id")
        ).map((el) => {
          return { user_id: parseInt(el[0], 10), albums: el[1] };
        });
        console.log(sharedAlbumssGroupedByOwner);
        dispatch({
          type: "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED",
          payload: sharedAlbumssGroupedByOwner,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsSharedFromMe() {
  return function (dispatch) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_FROM_ME" });
    Server.get("/albums/user/shared/fromme/")
      .then((response) => {
        console.log(response.data.results);
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED",
          payload: response.data.results,
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
