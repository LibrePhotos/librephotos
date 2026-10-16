import type { SetPhotosLocationResponse } from "@librephotos/api-client";
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

/** Empty trash queued its job (#2203); the photos go in the background. */
function emptyTrashStarted(count: number) {
  toast.success(i18n.t("toasts.emptytrashstarted", { count }), { title: i18n.t("toasts.emptytrashstartedtitle") });
}

/** The Empty trash job deleted every photo it found. */
function trashEmptied(count: number) {
  toast.success(i18n.t("toasts.trashemptied", { count }), { title: i18n.t("toasts.trashemptiedtitle") });
}

/** The Empty trash job left photos behind: their files could not be deleted. It stays until closed. */
function trashEmptiedWithErrors(deleted: number, failed: number) {
  toast.warning(i18n.t("toasts.trashemptiedwitherrors", { count: failed, deleted }), {
    title: i18n.t("toasts.trashemptiedwitherrorstitle"),
    autoClose: false,
  });
}

/** The Empty trash job failed before it could say how many photos it deleted. */
function trashEmptyFailed() {
  toast.error(i18n.t("toasts.trashemptyfailed"), { title: i18n.t("toasts.trashemptiedwitherrorstitle") });
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

function setPhotosRating(numberOfPhotos: number, rating: number) {
  const message =
    rating === 0
      ? i18n.t("toasts.clearrating", { count: numberOfPhotos })
      : i18n.t("toasts.setrating", { count: numberOfPhotos, rating });
  toast.success(message, { title: i18n.t("toasts.setratingtitle") });
}

// One toast for a bulk date change (#2278): how many photos moved, and how many a shift skipped
// because they have no date.
function photosDateChanged(changed: number, skippedWithoutDate: number) {
  const message = i18n.t("toasts.datechanged", { count: changed });
  const skipped = skippedWithoutDate ? ` ${i18n.t("toasts.dateskipped", { count: skippedWithoutDate })}` : "";
  toast.success(message + skipped, { title: i18n.t("toasts.datechangedtitle") });
}

/** Apply date rules to existing photos (#437) queued its job. */
function dateRulesStarted() {
  toast.success(i18n.t("toasts.daterulesstarted"), { title: i18n.t("toasts.daterulesstartedtitle") });
}

/**
 * The Apply date rules job went through every photo: how many moved to another day, and how many keep
 * the date set by hand. Photos it could not read make it a warning that stays until closed.
 */
function dateRulesApplied(moved: number, keptHandSet: number, failed: number) {
  const parts = [i18n.t("toasts.daterulesmoved", { count: moved })];
  if (keptHandSet) parts.push(i18n.t("toasts.dateruleskept", { count: keptHandSet }));
  if (failed) {
    parts.push(i18n.t("toasts.daterulesunread", { count: failed }));
    toast.warning(parts.join(" "), { title: i18n.t("toasts.daterulesappliedtitle"), autoClose: false });
    return;
  }
  toast.success(parts.join(" "), { title: i18n.t("toasts.daterulesappliedtitle") });
}

/** The Apply date rules job failed: too many photos could not be read, or it could not start them. */
function dateRulesFailed() {
  toast.error(i18n.t("toasts.daterulesfailed"), { title: i18n.t("toasts.daterulesfailedtitle") });
}

/** "Write metadata to files" (#2287) queued its job. */
function writeMetadataStarted() {
  toast.success(i18n.t("toasts.writemetadatastarted"), { title: i18n.t("toasts.writemetadatastartedtitle") });
}

/**
 * The "Write metadata to files" job went through every photo: how many it wrote. Photos it could
 * not write make it a warning that stays until closed.
 */
function writeMetadataDone(written: number, failed: number) {
  const message = i18n.t("toasts.writemetadatawritten", { count: written });
  if (failed) {
    const unwritten = i18n.t("toasts.writemetadataunwritten", { count: failed });
    toast.warning(`${message} ${unwritten}`, { title: i18n.t("toasts.writemetadatadonetitle"), autoClose: false });
    return;
  }
  toast.success(message, { title: i18n.t("toasts.writemetadatadonetitle") });
}

/** The "Write metadata to files" job failed: too many files could not be written, or it could not start. */
function writeMetadataFailed() {
  toast.error(i18n.t("toasts.writemetadatafailed"), { title: i18n.t("toasts.writemetadatafailedtitle") });
}

function togglePhotosHidden(numberOfPhotos: number, isHidden: boolean) {
  const notificationMessage = isHidden
    ? i18n.t("toasts.hidephoto", { numberOfPhotos })
    : i18n.t("toasts.unhidephoto", { numberOfPhotos });
  toast.success(notificationMessage, { title: i18n.t("toasts.sethidetitle") });
}

/** Archived photos leave the timeline and Memories only (#545): the toast says where they still are. */
function togglePhotosArchived(count: number, isArchived: boolean) {
  const message = isArchived ? i18n.t("toasts.archivephoto", { count }) : i18n.t("toasts.unarchivephoto", { count });
  toast.success(message, { title: i18n.t("toasts.setarchivetitle") });
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

/** A rescan of chosen photos started (#2214): what it reads again, and what it keeps. */
function rescanPhotosStarted(count: number) {
  toast.success(i18n.t("toasts.rescanphotos"), { title: i18n.t("toasts.rescanphotostitle", { count }) });
}

/** A rescan of chosen photos did not start; `message` says why (the server's words). */
function rescanPhotosFailed(message: string) {
  toast.error(message, { title: i18n.t("toasts.rescanphotosfailedtitle") });
}

function startOcrScan() {
  toast.success(i18n.t("toasts.ocrscan"), { title: i18n.t("toasts.ocrscantitle") });
}

function startFullOcrScan() {
  toast.success(i18n.t("toasts.fullocrscan"), { title: i18n.t("toasts.ocrscantitle") });
}

/** The library caption job started (#2211); `downloadsModel`: it waits for the captioning model. */
function startCaptionsJob(fullScan: boolean, downloadsModel: boolean) {
  let message = i18n.t(fullScan ? "toasts.captionsjobfull" : "toasts.captionsjob");
  if (downloadsModel) {
    message = i18n.t("toasts.captionsjobmodeldownload");
  }
  toast.success(message, { title: i18n.t("toasts.captionsjobtitle") });
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

/** A location edit whose lookup worked, at a spot with no place name such as open sea (#2589). */
function locationSavedNoPlace() {
  toast.success(i18n.t("toasts.locationsavednoplace"), { title: i18n.t("toasts.editphototitle") });
}

/**
 * The location of selected photos was set (#2279): how many got it and how many kept their own,
 * or a warning when the place name could not be looked up (the coordinates are saved).
 */
function photosLocationSet({ count, skipped_with_location: skipped, geocoded }: SetPhotosLocationResponse) {
  const title = i18n.t("toasts.setlocationtitle");
  const kept = skipped > 0 ? ` ${i18n.t("toasts.setlocationkept", { count: skipped })}` : "";
  if (count === 0) {
    toast.warning(i18n.t("toasts.setlocationnone"), { title });
  } else if (!geocoded) {
    toast.warning(`${i18n.t("toasts.setlocationwithoutplace", { count })}${kept}`, { title });
  } else {
    toast.success(`${i18n.t("toasts.setlocation", { count })}${kept}`, { title });
  }
}

/** A photo's location was removed: it left the map and Places (#2209). */
function locationRemoved() {
  toast.success(i18n.t("toasts.locationremoved"), { title: i18n.t("toasts.locationremovedtitle") });
}

/** `clockwiseDegrees` is the turn the user chose, as seen on screen; negative is counter-clockwise (#2587). */
function photoRotated(clockwiseDegrees: number) {
  const degrees = Math.abs(clockwiseDegrees);
  const message =
    clockwiseDegrees < 0
      ? i18n.t("toasts.rotatephotocounterclockwise", { degrees })
      : i18n.t("toasts.rotatephotoclockwise", { degrees });
  toast.success(message, { title: i18n.t("toasts.rotatephototitle") });
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
  dateRulesApplied,
  dateRulesFailed,
  dateRulesStarted,
  deleteMissingPhotos,
  downloadCompleted,
  downloadFailed,
  downloadStarting,
  emptyTrashStarted,
  locationRemoved,
  locationSavedNoPlace,
  locationSavedWithoutPlace,
  photoRotated,
  photosDateChanged,
  photosLocationSet,
  removePhotos,
  rescanPhotosFailed,
  rescanPhotosStarted,
  savePhotoCaptions,
  scanDirectoryRequired,
  setPhotosCategory,
  setPhotosRating,
  startCaptionsJob,
  startFullOcrScan,
  startFullPhotoScan,
  startNextcloudPhotoScan,
  startOcrScan,
  startPhotoScan,
  togglePhotoDelete,
  togglePhotosFavorite,
  togglePhotoSharing,
  togglePhotosArchived,
  togglePhotosHidden,
  togglePhotosPublic,
  trashEmptied,
  trashEmptiedWithErrors,
  trashEmptyFailed,
  updatePhoto,
  writeMetadataDone,
  writeMetadataFailed,
  writeMetadataStarted,
};
