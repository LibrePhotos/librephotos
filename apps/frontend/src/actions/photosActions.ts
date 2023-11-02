import { showNotification } from "@mantine/notifications";
import _ from "lodash";
import type { Dispatch } from "redux";
import { z } from "zod";

// eslint-disable-next-line import/no-cycle
import { Server } from "../api_client/apiClient";
import { photoDetailsApi } from "../api_client/photos/photoDetail";
import i18n from "../i18n";
// eslint-disable-next-line import/no-cycle
import { PhotosetType } from "../reducers/photosReducer";
import type { AppDispatch } from "../store/store";
import { getPhotosFlatFromGroupedByDate, getPhotosFlatFromGroupedByUser } from "../util/util";
import type { DatePhotosGroup, Photo, PigPhoto, SimpleUser } from "./photosActions.types";
import { DatePhotosGroupSchema, PhotoSchema, PigPhotoSchema, SharedFromMePhotoSchema } from "./photosActions.types";

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

const fetchPhotosetRejected = (err: string) => ({
  type: FETCH_PHOTOSET_REJECTED,
  payload: err,
});

export function downloadPhotos(image_hashes: string[]) {
  return function () {
    Server.post(
      `photos/download`,
      {
        image_hashes,
      },
      {
        responseType: "blob",
      }
    ).then(response => {
      const downloadUrl = window.URL.createObjectURL(new Blob([response.data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", "file.zip");
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  };
}

export function setPhotosShared(image_hashes: string[], val_shared: boolean, target_user: SimpleUser) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_SHARED" });
    Server.post(`photosedit/share/`, {
      image_hashes,
      shared: val_shared,
      target_user_id: target_user.id,
    })
      .then(() => {
        let notificationMessage = i18n.t("toasts.unsharephoto", {
          username: target_user.username,
          numberOfPhotos: image_hashes.length,
        });
        if (val_shared) {
          notificationMessage = i18n.t("toasts.sharephoto", {
            username: target_user.username,
            numberOfPhotos: image_hashes.length,
          });
        }
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.sharephototitle"),
          color: "teal",
        });

        if (image_hashes.length === 1) {
          // @ts-ignore
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        }
      })
      .catch(err => {
        dispatch({ type: "SET_PHOTOS_SHARED_REJECTED", payload: err });
      });
  };
}

const RecentlyAddedResponseDataSchema = z.object({
  results: PigPhotoSchema.array(),
  date: z.string(),
});
export const FETCH_RECENTLY_ADDED_PHOTOS = "FETCH_RECENTLY_ADDED_PHOTOS";
export const FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED = "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED";
export const FETCH_RECENTLY_ADDED_PHOTOS_REJECTED = "FETCH_RECENTLY_ADDED_PHOTOS_REJECTED";

export function fetchRecentlyAddedPhotos(dispatch: AppDispatch) {
  dispatch({ type: FETCH_RECENTLY_ADDED_PHOTOS });
  Server.get("photos/recentlyadded/")
    .then(response => {
      const data = RecentlyAddedResponseDataSchema.parse(response.data);
      const photosFlat: PigPhoto[] = data.results;
      dispatch({
        type: FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED,
        payload: {
          photosFlat,
          date: response.data.date,
        },
      });
    })
    .catch(error => {
      dispatch({
        type: FETCH_RECENTLY_ADDED_PHOTOS_REJECTED,
        payload: error,
      });
    });
}

const PigPhotoListResponseSchema = z.object({
  results: PigPhotoSchema.array(),
});

export function fetchPhotosSharedToMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PHOTOSET });
    Server.get("photos/shared/tome/")
      .then(response => {
        const data = PigPhotoListResponseSchema.parse(response.data);
        const sharedPhotosGroupedByOwner: UserPhotosGroup[] = _.toPairs(_.groupBy(data.results, "owner.id")).map(
          el => ({ userId: parseInt(el[0], 10), photos: el[1] })
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
      .catch(err => {
        dispatch(fetchPhotosetRejected(err));
      });
  };
}

const PhotosSharedFromMeResponseSchema = z.object({
  results: SharedFromMePhotoSchema.array(),
});

export function fetchPhotosSharedFromMe() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: FETCH_PHOTOSET });
    Server.get("photos/shared/fromme/")
      .then(response => {
        const data = PhotosSharedFromMeResponseSchema.parse(response.data);
        const sharedPhotosGroupedBySharedTo: UserPhotosGroup[] = _.toPairs(_.groupBy(data.results, "user_id")).map(
          el => ({
            userId: parseInt(el[0], 10),
            photos: el[1].map(item => item.photo),
          })
        );

        dispatch({
          type: FETCH_PHOTOSET_FULFILLED,
          payload: {
            photosFlat: getPhotosFlatFromGroupedByUser(sharedPhotosGroupedBySharedTo),
            photosGroupedByUser: sharedPhotosGroupedBySharedTo,
            photosetType: PhotosetType.SHARED_BY_ME,
          },
        });
      })
      .catch(err => {
        dispatch(fetchPhotosetRejected(err));
      });
  };
}

const PhotosUpdatedResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
export const SET_PHOTOS_PUBLIC_FULFILLED = "SET_PHOTOS_PUBLIC_FULFILLED";

export function setPhotosPublic(image_hashes: string[], val_public: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_PUBLIC" });
    Server.post(`photosedit/makepublic/`, { image_hashes, val_public })
      .then(response => {
        const data = PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_PUBLIC_FULFILLED,
          payload: { image_hashes, val_public, updatedPhotos },
        });
        let notificationMessage = i18n.t("toasts.removepublicphoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (val_public) {
          notificationMessage = i18n.t("toasts.addpublicphoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.setpublicphotostitle"),
          color: "teal",
        });

        if (image_hashes.length === 1) {
          // @ts-ignore
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        }
      })
      .catch(err => {
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
    Server.post(`photosedit/favorite/`, { image_hashes, favorite })
      .then(response => {
        const data = PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_FAVORITE_FULFILLED,
          payload: { image_hashes, favorite, updatedPhotos },
        });
        let notificationMessage = i18n.t("toasts.unfavoritephoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (favorite) {
          notificationMessage = i18n.t("toasts.favoritephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }

        // @ts-ignore
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.setfavoritestitle"),
          color: "teal",
        });
      })
      .catch(err => {
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
      data: { image_hashes },
    })
      .then(response => {
        const data = PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: PHOTOS_FINAL_DELETED_FULFILLED,
          payload: { image_hashes, updatedPhotos },
        });
        const notificationMessage = i18n.t("toasts.finaldeletephoto", {
          numberOfPhotos: image_hashes.length,
        });
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.finaldeletephototitle"),
          color: "teal",
        });
      })
      .catch(err => {
        dispatch({ type: PHOTOS_FINAL_DELETED_REJECTED, payload: err });
      });
  };
}

export function deleteDuplicateImage(image_hash: string, path: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: PHOTOS_FINAL_DELETED });
    Server.delete(`/photosedit/duplicate/delete`, {
      data: { image_hash, path },
    })
      .then(() => {
        // To-Do: Change locale for this
        const notificationMessage = i18n.t("toasts.finaldeletephoto", {
          numberOfPhotos: 1,
        });
        // To-Do: Change locale for this
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.finaldeletephototitle"),
          color: "teal",
        });
      })
      .catch(err => {
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
    Server.post(`photosedit/setdeleted/`, { image_hashes, deleted })
      .then(response => {
        const data = PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_DELETED_FULFILLED,
          payload: { image_hashes, deleted, updatedPhotos },
        });
        let notificationMessage = i18n.t("toasts.recoverphoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (deleted) {
          notificationMessage = i18n.t("toasts.deletephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.setdeletetitle"),
          color: "teal",
        });
      })
      .catch(err => {
        dispatch({ type: SET_PHOTOS_DELETED_REJECTED, payload: err });
      });
  };
}

export const SET_PHOTOS_HIDDEN_FULFILLED = "SET_PHOTOS_HIDDEN_FULFILLED";

export function setPhotosHidden(image_hashes: string[], hidden: boolean) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "SET_PHOTOS_HIDDEN" });
    Server.post(`photosedit/hide/`, { image_hashes, hidden })
      .then(response => {
        const data = PhotosUpdatedResponseSchema.parse(response.data);
        const updatedPhotos: Photo[] = data.updated;
        dispatch({
          type: SET_PHOTOS_HIDDEN_FULFILLED,
          payload: { image_hashes, hidden, updatedPhotos },
        });
        let notificationMessage = i18n.t("toasts.unhidephoto", {
          numberOfPhotos: image_hashes.length,
        });
        if (hidden) {
          notificationMessage = i18n.t("toasts.hidephoto", {
            numberOfPhotos: image_hashes.length,
          });
        }
        showNotification({
          message: notificationMessage,
          title: i18n.t("toasts.sethidetitle"),
          color: "teal",
        });
        if (image_hashes.length === 1) {
          // @ts-ignore
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        }
      })
      .catch(err => {
        dispatch({ type: "SET_PHOTOS_HIDDEN_REJECTED", payload: err });
      });
  };
}

function triggerScan(dispatch: Dispatch<any>, url: string, i18nPrefix: string): void {
  dispatch({ type: "SCAN_PHOTOS" });
  dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });

  Server.get(url)
    .then(response => {
      const payload = JobResponseSchema.parse(response.data);
      showNotification({
        message: i18n.t(`toasts.${i18nPrefix}`),
        title: i18n.t(`toasts.${i18nPrefix}title`),
        color: "teal",
      });
      dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload });
    })
    .catch(payload => {
      dispatch({ type: "SCAN_PHOTOS_REJECTED", payload });
    });
}

export function scanPhotos() {
  return function (dispatch: Dispatch<any>) {
    triggerScan(dispatch, "scanphotos/", "scanphotos");
  };
}

export function scanUploadedPhotos() {
  return function (dispatch: Dispatch<any>) {
    triggerScan(dispatch, "scanuploadedphotos/", "scanuploadedphotos");
  };
}

export function scanAllPhotos() {
  return function (dispatch: Dispatch<any>) {
    triggerScan(dispatch, "fullscanphotos/", "fullscanphotos");
  };
}

export function scanNextcloudPhotos() {
  return function (dispatch: Dispatch<any>) {
    triggerScan(dispatch, "nextcloud/scanphotos/", "scannextcloudphotos");
  };
}

const FetchPhotosByDateSchema = z.object({
  results: DatePhotosGroupSchema.array(),
});

export function fetchHiddenPhotos(dispatch: AppDispatch) {
  dispatch({ type: FETCH_PHOTOSET });
  Server.get("photos/hidden/", { timeout: 100000 })
    .then(response => {
      const data = FetchPhotosByDateSchema.parse(response.data);
      const photosGroupedByDate: DatePhotosGroup[] = data.results;
      dispatch({
        type: FETCH_PHOTOSET_FULFILLED,
        payload: {
          photosGroupedByDate,
          photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
          photosetType: PhotosetType.HIDDEN,
        },
      });
    })
    .catch(err => {
      dispatch(fetchPhotosetRejected(err));
    });
}

const PaginatedPigPhotosSchema = z.object({
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
    .then(response => {
      const data = PaginatedPigPhotosSchema.parse(response.data);
      const photosFlat: PigPhoto[] = data.results;
      const photosCount = data.count;
      dispatch({
        type: FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED,
        payload: { photosFlat, fetchedPage: page, photosCount },
      });
    })
    .catch(err => {
      console.error(err);
      dispatch({
        type: FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED,
        payload: err,
      });
    });
}

export function generatePhotoIm2txtCaption(image_hash: string) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "GENERATE_PHOTO_CAPTION" });
    Server.post("photosedit/generateim2txt", { image_hash })
      .then(() => {
        dispatch({ type: "GENERATE_PHOTO_CAPTION_FULFILLED" });
        // @ts-ignore
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hash)).refetch();
      })
      .catch(error => {
        dispatch({ type: "GENERATE_PHOTO_CAPTION_REJECTED" });
        console.error(error);
      });
  };
}

export function savePhotoCaption(image_hash: string, caption?: string | undefined) {
  return function (dispatch: Dispatch<any>) {
    Server.post("photosedit/savecaption", { image_hash, caption })
      .then(() => {
        dispatch({ type: "SAVE_PHOTO_CAPTION_FULFILLED" });
        // @ts-ignore
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hash)).refetch();
        showNotification({
          message: i18n.t("toasts.savecaptions"),
          title: i18n.t("toasts.captionupdate"),
          color: "teal",
        });
      })
      .catch(error => {
        dispatch({ type: "SAVE_PHOTO_CAPTION_REJECTED" });
        console.error(error);
      });
  };
}

export function editPhoto(image_hash: string, photo_details: any) {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: "EDIT_PHOTO" });
    Server.patch(`photos/edit/${image_hash}/`, photo_details)
      .then(() => {
        dispatch({ type: "EDIT_PHOTO_FULFILLED" });
        showNotification({
          message: i18n.t("toasts.editphoto"),
          title: i18n.t("toasts.editphototitle"),
          color: "teal",
        });
        // @ts-ignore
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hash)).refetch();
      })
      .catch(error => {
        dispatch({ type: "EDIT_PHOTO_REJECTED" });
        console.error(error);
      });
  };
}
