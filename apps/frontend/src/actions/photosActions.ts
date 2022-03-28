import { Server } from "../api_client/apiClient";
import _ from "lodash";
const reapop = require("reapop");
const notify = reapop.notify;
import { adjustDateFormat, getPhotosFlatFromGroupedByDate, getPhotosFlatFromGroupedByUser } from "../util/util";
import { PhotosetType } from "../reducers/photosReducer";
import { Dispatch } from "redux";
import {
  DatePhotosGroup,
  DatePhotosGroupSchema,
  Photo,
  PhotoSchema,
  PigPhoto,
  PigPhotoSchema,
  SharedFromMePhotoSchema,
  SimpleUser,
} from "./photosActions.types";
import { z } from "zod";
import { AppDispatch } from "../store/store";
import i18n from "../i18n";

export type UserPhotosGroup = {
  userId: number;
  photos: PigPhoto[];
};

const JobResponseSchema = z.object({
  status: z.boolean(),
  job_id: z.string(),
});

export const FETCH_PHOTOSET = "FETCH_PHOTOSET";
export const FETCH_PHOTOSET_FULFILLED = "FETCH_PHOTOSET_FULFILLED";
export const FETCH_PHOTOSET_REJECTED = "FETCH_PHOTOSET_REJECTED";

const fetchPhotosetRejected = (err: string) => {
  return {
    type: FETCH_PHOTOSET_REJECTED,
    payload: err,
  };
};

export function uploadPhotos(form_data: any, dispatch: Dispatch<any>) {
  Server.post("/photos/upload", form_data, {
    headers: {
      "content-type": "multipart/form-data",
    },
  }).then((response: any) => {
    dispatch(
      notify("Upload successful", {
        title: i18n.t("toasts.sharephototitle"),
        status: "success",
        dismissible: true,
        dismissAfter: 3000,
        position: "bottom-right",
      })
    );
  });
}

export function downloadPhotos(image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    Server.post(
      `photos/download`,
      {
        image_hashes: image_hashes,
      },
      {
        responseType: "blob",
      }
    ).then((reponse) => {
      const downloadUrl = window.URL.createObjectURL(new Blob([reponse.data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", "file.zip");
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  };
}

export const SET_PHOTOS_SHARED_FULFILLED = "SET_PHOTOS_SHARED_FULFILLED";
export function setPhotosShared(image_hashes: string[], val_shared: boolean, target_user: SimpleUser) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_SHARED" });
    Server.post(`photosedit/share/`, {
      image_hashes: image_hashes,
      shared: val_shared,
      target_user_id: target_user.id,
    })
      .then((response) => {
        var notificationMessage = i18n.t("toasts.unsharephoto", {
          username: target_user.username,
          numberOfPhotos: image_hashes.length,
        });
        if (val_shared) {
          notificationMessage = i18n.t("toasts.sharephoto", {
            username: target_user.username,
            numberOfPhotos: image_hashes.length,
          });
        }
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.sharephototitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        if (image_hashes.length === 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]));
        }
      })
      .catch((err) => {
        dispatch({ type: "SET_PHOTOS_SHARED_REJECTED", payload: err });
      });
  };
}

const _RecentlyAddedResponseDataSchema = z.object({
  results: PigPhotoSchema.array(),
  date: z.string(),
});
export const FETCH_RECENTLY_ADDED_PHOTOS = "FETCH_RECENTLY_ADDED_PHOTOS";
export const FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED = "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED";
export const FETCH_RECENTLY_ADDED_PHOTOS_REJECTED = "FETCH_RECENTLY_ADDED_PHOTOS_REJECTED";
export function fetchRecentlyAddedPhotos(dispatch: AppDispatch) {
  dispatch({ type: FETCH_RECENTLY_ADDED_PHOTOS });
  Server.get("photos/recentlyadded/")
    .then((response) => {
      const data = _RecentlyAddedResponseDataSchema.parse(response.data);
      const photosFlat: PigPhoto[] = data.results;
      dispatch({
        type: FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED,
        payload: {
          photosFlat: photosFlat,
          date: response.data.date,
        },
      });
    })
    .catch((error) => {
      dispatch({
        type: FETCH_RECENTLY_ADDED_PHOTOS_REJECTED,
        payload: error,
      });
    });
}

const _PigPhotoListResponseSchema = z.object({
  results: PigPhotoSchema.array(),
});
export function fetchPhotosSharedToMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PHOTOSET });
    Server.get("photos/shared/tome/")
      .then((response) => {
        const data = _PigPhotoListResponseSchema.parse(response.data);
        const sharedPhotosGroupedByOwner: UserPhotosGroup[] = _.toPairs(_.groupBy(data.results, "owner.id")).map(
          (el) => {
            return { userId: parseInt(el[0], 10), photos: el[1] };
          }
        );

        dispatch({
          type: FETCH_PHOTOSET_FULFILLED,
          payload: {
            photosFlat: getPhotosFlatFromGroupedByUser(sharedPhotosGroupedByOwner),
            photosGroupedByUser: sharedPhotosGroupedByOwner,
            photosetType: PhotosetType.SHARED_TO_ME,
          },
        });
      })
      .catch((err) => {
        dispatch(fetchPhotosetRejected(err));
      });
  };
}

const _PhotosSharedFromMeResponseSchema = z.object({
  results: SharedFromMePhotoSchema.array(),
});
export function fetchPhotosSharedFromMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PHOTOSET });
    Server.get("photos/shared/fromme/")
      .then((response) => {
        const data = _PhotosSharedFromMeResponseSchema.parse(response.data);
        const sharedPhotosGroupedBySharedTo: UserPhotosGroup[] = _.toPairs(_.groupBy(data.results, "user_id")).map(
          (el) => {
            return {
              userId: parseInt(el[0], 10),
              photos: el[1].map((item) => item.photo),
            };
          }
        );

        console.log(sharedPhotosGroupedBySharedTo);

        dispatch({
          type: FETCH_PHOTOSET_FULFILLED,
          payload: {
            photosFlat: getPhotosFlatFromGroupedByUser(sharedPhotosGroupedBySharedTo),
            photosGroupedByUser: sharedPhotosGroupedBySharedTo,
            photosetType: PhotosetType.SHARED_BY_ME,
          },
        });
      })
      .catch((err) => {
        dispatch(fetchPhotosetRejected(err));
      });
  };
}

const _PhotosUpdatedResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
export const SET_PHOTOS_PUBLIC_FULFILLED = "SET_PHOTOS_PUBLIC_FULFILLED";
export function setPhotosPublic(image_hashes: string[], val_public: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_PUBLIC" });
    Server.post(`photosedit/makepublic/`, {
      image_hashes: image_hashes,
      val_public: val_public,
    })
      .then((response) => {
        const data = _PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_PUBLIC_FULFILLED,
          payload: {
            image_hashes: image_hashes,
            val_public: val_public,
            updatedPhotos: updatedPhotos,
          },
        });
        var notificationMessage = i18n.t("toasts.setphotopublic", {
          numberOfPhotos: image_hashes.length,
        });
        if (val_public) {
          notificationMessage = i18n.t("toasts.removephotopublic", {
            numberOfPhotos: image_hashes.length,
          });
        }
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.setpublicphotostitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        if (image_hashes.length === 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]));
        }
      })
      .catch((err) => {
        dispatch({ type: "SET_PHOTOS_PUBLIC_REJECTED", payload: err });
      });
  };
}

export const SET_PHOTOS_FAVORITE = "SET_PHOTOS_FAVORITE";
export const SET_PHOTOS_FAVORITE_FULFILLED = "SET_PHOTOS_FAVORITE_FULFILLED";
export const SET_PHOTOS_FAVORITE_REJECTED = "SET_PHOTOS_FAVORITE_REJECTED";
export function setPhotosFavorite(image_hashes: string[], favorite: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: SET_PHOTOS_FAVORITE });
    Server.post(`photosedit/favorite/`, {
      image_hashes: image_hashes,
      favorite: favorite,
    })
      .then((response) => {
        const data = _PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_FAVORITE_FULFILLED,
          payload: {
            image_hashes: image_hashes,
            favorite: favorite,
            updatedPhotos: updatedPhotos,
          },
        });
        var notificationMessage = i18n.t("toasts.unfavoritephoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (favorite) {
          notificationMessage = i18n.t("toasts.favoritephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.setfavoritestitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
      })
      .catch((err) => {
        dispatch({ type: SET_PHOTOS_FAVORITE_REJECTED, payload: err });
      });
  };
}

export const PHOTOS_FINAL_DELETED = "PHOTOS_FINAL_DELETED";
export const PHOTOS_FINAL_DELETED_FULFILLED = "PHOTOS_FINAL_DELETED_FULFILLED";
export const PHOTOS_FINAL_DELETED_REJECTED = "PHOTOS_FINAL_DELETED_REJECTED";
export function finalPhotosDeleted(image_hashes: string[]) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: PHOTOS_FINAL_DELETED });
    Server.delete(`photosedit/delete`, {
      data: {
        image_hashes: image_hashes,
      },
    })
      .then((response) => {
        const data = _PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: PHOTOS_FINAL_DELETED_FULFILLED,
          payload: {
            image_hashes: image_hashes,
            updatedPhotos: updatedPhotos,
          },
        });
        var notificationMessage = i18n.t("toasts.finaldeletephoto", {
          numberOfPhotos: image_hashes.length,
        });
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.finaldeletephototitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
      })
      .catch((err) => {
        dispatch({ type: PHOTOS_FINAL_DELETED_REJECTED, payload: err });
      });
  };
}

export const SET_PHOTOS_DELETED = "SET_PHOTOS_DELETED";
export const SET_PHOTOS_DELETED_FULFILLED = "SET_PHOTOS_DELETED_FULFILLED";
export const SET_PHOTOS_DELETED_REJECTED = "SET_PHOTOS_DELETED_REJECTED";
export function setPhotosDeleted(image_hashes: string[], deleted: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: SET_PHOTOS_DELETED });
    Server.post(`photosedit/setdeleted/`, {
      image_hashes: image_hashes,
      deleted: deleted,
    })
      .then((response) => {
        const data = _PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_DELETED_FULFILLED,
          payload: {
            image_hashes: image_hashes,
            deleted: deleted,
            updatedPhotos: updatedPhotos,
          },
        });
        var notificationMessage = i18n.t("toasts.recoverphoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (deleted) {
          notificationMessage = i18n.t("toasts.deletephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.setdeletetitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
      })
      .catch((err) => {
        dispatch({ type: SET_PHOTOS_DELETED_REJECTED, payload: err });
      });
  };
}

export const SET_PHOTOS_HIDDEN_FULFILLED = "SET_PHOTOS_HIDDEN_FULFILLED";
export function setPhotosHidden(image_hashes: string[], hidden: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_HIDDEN" });
    Server.post(`photosedit/hide/`, {
      image_hashes: image_hashes,
      hidden: hidden,
    })
      .then((response) => {
        const data = _PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_HIDDEN_FULFILLED,
          payload: {
            image_hashes: image_hashes,
            hidden: hidden,
            updatedPhotos: updatedPhotos,
          },
        });
        var notificationMessage = i18n.t("toasts.unhidephoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (hidden) {
          notificationMessage = i18n.t("toasts.hidephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        dispatch(
          notify(notificationMessage, {
            title: i18n.t("toasts.sethidetitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        if (image_hashes.length === 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]));
        }
      })
      .catch((err) => {
        dispatch({ type: "SET_PHOTOS_HIDDEN_REJECTED", payload: err });
      });
  };
}

export function scanPhotos() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SCAN_PHOTOS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });

    Server.get(`scanphotos/`)
      .then((response) => {
        const jobResponse = JobResponseSchema.parse(response.data);
        dispatch(
          notify(i18n.t("toasts.scanphotos"), {
            title: i18n.t("toasts.scanphotostitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      })
      .catch((err) => {
        dispatch({ type: "SCAN_PHOTOS_REJECTED", payload: err });
      });
  };
}

export function scanAllPhotos() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SCAN_PHOTOS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });

    Server.get(`fullscanphotos/`)
      .then((response) => {
        const jobResponse = JobResponseSchema.parse(response.data);
        dispatch(
          notify(i18n.t("toasts.fullscanphotos"), {
            title: i18n.t("toasts.fullscanphotostitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      })
      .catch((err) => {
        dispatch({ type: "SCAN_PHOTOS_REJECTED", payload: err });
      });
  };
}

export function scanNextcloudPhotos() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SCAN_PHOTOS" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });

    Server.get(`nextcloud/scanphotos/`)
      .then((response) => {
        const jobResponse = JobResponseSchema.parse(response.data);
        dispatch(
          notify(i18n.t("toasts.scannextcloudphotos"), {
            title: i18n.t("toasts.scannextcloudphotostitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      })
      .catch((err) => {
        dispatch({ type: "SCAN_PHOTOS_REJECTED", payload: err });
      });
  };
}

const _FetchPhotosByDateSchema = z.object({
  results: DatePhotosGroupSchema.array(),
});

export function fetchHiddenPhotos(dispatch: AppDispatch) {
  dispatch({ type: FETCH_PHOTOSET });
  Server.get("photos/hidden/", { timeout: 100000 })
    .then((response) => {
      const data = _FetchPhotosByDateSchema.parse(response.data);
      const photosGroupedByDate: DatePhotosGroup[] = data.results;
      adjustDateFormat(photosGroupedByDate);
      dispatch({
        type: FETCH_PHOTOSET_FULFILLED,
        payload: {
          photosGroupedByDate: photosGroupedByDate,
          photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
          photosetType: PhotosetType.HIDDEN,
        },
      });
    })
    .catch((err) => {
      dispatch(fetchPhotosetRejected(err));
    });
}

export function fetchPhotoDetail(image_hash: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "FETCH_PHOTO_DETAIL", payload: image_hash });
    Server.get(`photos/${image_hash}/`, { timeout: 100000 })
      .then((response) => {
        const photo = PhotoSchema.parse(response.data);
        dispatch({
          type: "FETCH_PHOTO_DETAIL_FULFILLED",
          payload: photo,
        });
      })
      .catch((err) => {
        console.log(err);
        dispatch({ type: "FETCH_PHOTO_DETAIL_REJECTED", payload: err });
      });
  };
}

const _PaginatedPigPhotosSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhotoSchema.array(),
});
export const FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED = "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED";
export const FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED = "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED";
export const FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED = "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED";
export function fetchNoTimestampPhotoPaginated(dispatch: AppDispatch, page: number) {
  dispatch({ type: FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED });
  Server.get(`photos/notimestamp/?page=${page}`, { timeout: 100000 })
    .then((response) => {
      const data = _PaginatedPigPhotosSchema.parse(response.data);
      const photosFlat: PigPhoto[] = data.results;
      const photosCount = data.count;
      dispatch({
        type: FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED,
        payload: {
          photosFlat: photosFlat,
          fetchedPage: page,
          photosCount: photosCount,
        },
      });
    })
    .catch((err) => {
      dispatch({
        type: FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED,
        payload: err,
      });
    });
}

export function generatePhotoIm2txtCaption(image_hash: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "GENERATE_PHOTO_CAPTION" });
    Server.post("photosedit/generateim2txt", { image_hash: image_hash })
      .then((response) => {
        console.log(response);
        dispatch({ type: "GENERATE_PHOTO_CAPTION_FULFILLED" });
        dispatch(fetchPhotoDetail(image_hash));
      })
      .catch((error) => {
        dispatch({ type: "GENERATE_PHOTO_CAPTION_REJECTED" });
        console.log(error);
      });
  };
}

export function editPhoto(image_hash: string, photo_details: any) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "EDIT_PHOTO" });
    Server.patch(`photos/edit/${image_hash}/`, photo_details)
      .then((response) => {
        dispatch({ type: "EDIT_PHOTO_FULFILLED" });
        dispatch(
          notify(i18n.t("toasts.editphoto"), {
            title: i18n.t("toasts.editphototitle"),
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "bottom-right",
          })
        );
      })
      .catch((error) => {
        dispatch({ type: "EDIT_PHOTO_REJECTED" });
        console.log(error);
      });
  };
}
