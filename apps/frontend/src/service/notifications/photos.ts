import i18n from "../../i18n";
import { toast } from "./toast";

function togglePhotoDelete(isDeleted: boolean, numberOfPhotos: number) {
  const notificationMessage = isDeleted
    ? i18n.t("toasts.deletephoto", { numberOfPhotos })
    : i18n.t("toasts.recoverphoto", { numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.setdeletetitle") });
}

function removePhotos(numberOfPhotos: number) {
  toast.success(i18n.t("toasts.finaldeletephoto", { numberOfPhotos }), {
    title: i18n.t("toasts.finaldeletephototitle"),
  });
}

function downloadStarting() {
  toast.success(i18n.t("toasts.downloadstarting"), { title: i18n.t("toasts.downloadstart") });
}

function downloadCompleted() {
  toast.success(i18n.t("toasts.downloadcompleted"), { title: i18n.t("toasts.downloadcomplete") });
}

function downloadFailed() {
  toast.error(i18n.t("toasts.downloadfailed"), { title: i18n.t("toasts.downloaderror") });
}

function togglePhotoSharing(username: string, numberOfPhotos: number, isShared: boolean) {
  const notificationMessage = isShared
    ? i18n.t("toasts.sharephoto", { username, numberOfPhotos })
    : i18n.t("toasts.unsharephoto", { username, numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.sharephototitle") });
}

function togglePhotosPublic(numberOfPhotos: number, isPublic: boolean) {
  const notificationMessage = isPublic
    ? i18n.t("toasts.addpublicphoto", { numberOfPhotos })
    : i18n.t("toasts.removepublicphoto", { numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.setpublicphotostitle") });
}

function togglePhotosFavorite(numberOfPhotos: number, isFavorite: boolean) {
  const notificationMessage = isFavorite
    ? i18n.t("toasts.favoritephoto", { numberOfPhotos })
    : i18n.t("toasts.unfavoritephoto", { numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.setfavoritestitle") });
}

function togglePhotosHidden(numberOfPhotos: number, isHidden: boolean) {
  const notificationMessage = isHidden
    ? i18n.t("toasts.hidephoto", { numberOfPhotos })
    : i18n.t("toasts.unhidephoto", { numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.sethidetitle") });
}

function setPhotosCategory(numberOfPhotos: number, category: "photo" | "screenshot" | "document") {
  toast.success(i18n.t(`toasts.setcategory.${category}`, { count: numberOfPhotos }), {
    title: i18n.t("toasts.setcategorytitle"),
  });
}

function startPhotoScan() {
  toast.success(i18n.t("toasts.scanphotos"), { title: i18n.t("toasts.scanphotostitle") });
}

function startFullPhotoScan() {
  toast.success(i18n.t("toasts.fullscanphotos"), { title: i18n.t("toasts.fullscanphotostitle") });
}

function startOcrScan() {
  toast.success(i18n.t("toasts.ocrscan"), { title: i18n.t("toasts.ocrscantitle") });
}

function startFullOcrScan() {
  toast.success(i18n.t("toasts.fullocrscan"), { title: i18n.t("toasts.ocrscantitle") });
}

function startNextcloudPhotoScan() {
  toast.success(i18n.t("toasts.scannextcloudphotos"), { title: i18n.t("toasts.scannextcloudphotostitle") });
}

function savePhotoCaptions() {
  toast.success(i18n.t("toasts.savecaptions"), { title: i18n.t("toasts.captionupdate") });
}

function updatePhoto() {
  toast.success(i18n.t("toasts.editphoto"), { title: i18n.t("toasts.editphototitle") });
}

/** A location edit kept the coordinates, but no place name was found for them (#2253). */
function locationSavedWithoutPlace() {
  toast.warning(i18n.t("toasts.locationsavedwithoutplace"), { title: i18n.t("toasts.editphototitle") });
}

function rotatePhotos(numberOfPhotos: number, rotation: number) {
  toast.success(i18n.t("toasts.rotatephoto", { numberOfPhotos, rotation }), {
    title: i18n.t("toasts.rotatephototitle"),
  });
}

function deleteMissingPhotos() {
  toast.success(i18n.t("toasts.deletemissingphotos"), { title: i18n.t("toasts.deletemissingphotostitle") });
}

function copyPhotoToClipboard() {
  toast.success(i18n.t("toasts.copyphoto"), { title: i18n.t("toasts.copyphototitle") });
}

function copyPhotoToClipboardFailed() {
  toast.error(i18n.t("toasts.copyphotofailed"), { title: i18n.t("toasts.copyphototitle") });
}

function captionModelDownloading() {
  toast.warning(i18n.t("toasts.captionmodeldownloading"), { title: i18n.t("toasts.captionupdate") });
}

function scanDirectoryRequired() {
  toast.error(i18n.t("toasts.scan_directory_required"), { title: i18n.t("toasts.scanphotostitle") });
}

export const photos = {
  captionModelDownloading,
  copyPhotoToClipboard,
  copyPhotoToClipboardFailed,
  deleteMissingPhotos,
  downloadCompleted,
  downloadFailed,
  downloadStarting,
  locationSavedWithoutPlace,
  removePhotos,
  rotatePhotos,
  savePhotoCaptions,
  scanDirectoryRequired,
  setPhotosCategory,
  startFullOcrScan,
  startFullPhotoScan,
  startNextcloudPhotoScan,
  startOcrScan,
  startPhotoScan,
  togglePhotoDelete,
  togglePhotoSharing,
  togglePhotosFavorite,
  togglePhotosHidden,
  togglePhotosPublic,
  updatePhoto,
};
