import { showNotification } from "@mantine/notifications";

import i18n from "../../i18n";

function togglePhotoDelete(isDeleted: boolean, numberOfPhotos: number) {
  const notificationMessage = isDeleted
    ? i18n.t("toasts.deletephoto", { numberOfPhotos })
    : i18n.t("toasts.recoverphoto", { numberOfPhotos });
  showNotification({
    message: notificationMessage,
    title: i18n.t("toasts.setdeletetitle"),
    color: "teal",
  });
}

function removePhotos(numberOfPhotos: number) {
  showNotification({
    message: i18n.t("toasts.finaldeletephoto", { numberOfPhotos }),
    title: i18n.t("toasts.finaldeletephototitle"),
    color: "teal",
  });
}

function downloadStarting() {
  showNotification({
    message: "Download Starting ...",
    title: i18n.t("toasts.downloadstart"),
    color: "teal",
  });
}

function downloadCompleted() {
  showNotification({
    message: "Download Completed",
    title: i18n.t("toasts.downloadcomplete"),
    color: "teal",
  });
}

function downloadFailed() {
  showNotification({
    message: "Download failed",
    title: i18n.t("toasts.downloaderror"),
    color: "red",
  });
}

function togglePhotoSharing(username: string, numberOfPhotos: number, isShared: boolean) {
  const notificationMessage = isShared
    ? i18n.t("toasts.sharephoto", { username, numberOfPhotos })
    : i18n.t("toasts.unsharephoto", { username, numberOfPhotos });
  showNotification({
    message: notificationMessage,
    title: i18n.t("toasts.sharephototitle"),
    color: "teal",
  });
}

function togglePhotosPublic(numberOfPhotos: number, isPublic: boolean) {
  const notificationMessage = isPublic
    ? i18n.t("toasts.addpublicphoto", { numberOfPhotos })
    : i18n.t("toasts.removepublicphoto", { numberOfPhotos });
  showNotification({
    message: notificationMessage,
    title: i18n.t("toasts.setpublicphotostitle"),
    color: "teal",
  });
}

function togglePhotosFavorite(numberOfPhotos: number, isFavorite: boolean) {
  const notificationMessage = isFavorite
    ? i18n.t("toasts.favoritephoto", { numberOfPhotos })
    : i18n.t("toasts.unfavoritephoto", { numberOfPhotos });
  showNotification({
    message: notificationMessage,
    title: i18n.t("toasts.setfavoritestitle"),
    color: "teal",
  });
}

function togglePhotosHidden(numberOfPhotos: number, isHidden: boolean) {
  const notificationMessage = isHidden
    ? i18n.t("toasts.hidephoto", { numberOfPhotos })
    : i18n.t("toasts.unhidephoto", { numberOfPhotos });
  showNotification({
    message: notificationMessage,
    title: i18n.t("toasts.sethidetitle"),
    color: "teal",
  });
}

function startPhotoScan() {
  showNotification({
    message: i18n.t("toasts.scanphotos"),
    title: i18n.t("toasts.scanphotostitle"),
    color: "teal",
  });
}

function startUploadedPhotoScan() {
  showNotification({
    message: i18n.t("toasts.scanuploadedphotos"),
    title: i18n.t("toasts.scanuploadedphotostitle"),
    color: "teal",
  });
}

function startFullPhotoScan() {
  showNotification({
    message: i18n.t("toasts.fullscanphotos"),
    title: i18n.t("toasts.fullscanphotostitle"),
    color: "teal",
  });
}

function startNextcloudPhotoScan() {
  showNotification({
    message: i18n.t("toasts.scannextcloudphotos"),
    title: i18n.t("toasts.scannextcloudphotostitle"),
    color: "teal",
  });
}

function savePhotoCaptions() {
  showNotification({
    message: i18n.t("toasts.savecaptions"),
    title: i18n.t("toasts.captionupdate"),
    color: "teal",
  });
}

function updatePhoto() {
  showNotification({
    message: i18n.t("toasts.editphoto"),
    title: i18n.t("toasts.editphototitle"),
    color: "teal",
  });
}

function deleteMissingPhotos() {
  showNotification({
    message: i18n.t("toasts.deletemissingphotos"),
    title: i18n.t("toasts.deletemissingphotostitle"),
    color: "teal",
  });
}

export const photos = {
  deleteMissingPhotos,
  downloadCompleted,
  downloadFailed,
  downloadStarting,
  removePhotos,
  savePhotoCaptions,
  startFullPhotoScan,
  startNextcloudPhotoScan,
  startPhotoScan,
  startUploadedPhotoScan,
  togglePhotoDelete,
  togglePhotoSharing,
  togglePhotosFavorite,
  togglePhotosHidden,
  togglePhotosPublic,
  updatePhoto,
};
