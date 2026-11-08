import type { ParseKeys } from "i18next";
import i18n from "../../i18n";
import { toast } from "./toast";

function jobFinished(title: string, job: string) {
  toast.success(i18n.t("toasts.jobfinished", { job }), { title });
}

function jobCancelled() {
  toast.warning(i18n.t("toasts.jobcancelled"), { title: i18n.t("toasts.jobcancelledtitle") });
}

/** A job trigger found a job of its kind already queued or running (HTTP 409), and follows that one. */
function jobAlreadyRunning() {
  toast.warning(i18n.t("toasts.jobalreadyrunning"), { title: i18n.t("toasts.jobalreadyrunningtitle") });
}

/** The thumbnail metadata cleanup an admin started from the Admin Area (#2321). */
function startStripThumbnailMetadata() {
  toast.success(i18n.t("toasts.stripthumbnailmetadata"), { title: i18n.t("toasts.stripthumbnailmetadatatitle") });
}

/** The place name lookup an admin started from the Admin Area (#2302). */
function startDeduplicateFaces() {
  toast.success(i18n.t("toasts.deduplicatefaces"), { title: i18n.t("toasts.deduplicatefacestitle") });
}

/** The scan of another user's library an admin started from the Admin Area (#2037). */
function startUserPhotoScan(username: string) {
  toast.success(i18n.t("toasts.scanuserphotos", { username }), { title: i18n.t("toasts.scanphotostitle") });
}

/** The move of a user's photos outside their new scan directory to their trash (#2036). */
function startTrashPhotosOutsideLibrary(username: string, count: number) {
  toast.success(i18n.t("toasts.trashphotosoutsidelibrary", { username, count }), {
    title: i18n.t("toasts.trashphotosoutsidelibrarytitle"),
  });
}

/** The place name lookup an admin started from the Admin Area (#2302). */
function startLookUpPlaces() {
  toast.success(i18n.t("toasts.lookupplaces"), { title: i18n.t("toasts.lookupplacestitle") });
}

/** The file contents check an admin started from the Admin Area (#2040). */
function startCheckFileContents() {
  toast.success(i18n.t("toasts.checkfilecontents"), { title: i18n.t("toasts.checkfilecontentstitle") });
}

function requestFailed(title: string, message: string) {
  toast.error(message, { title });
}

/**
 * A save, edit or delete that failed and that nothing else reported (api_client/mutationErrors.ts):
 * the server's own message when it sent one, a generic line otherwise.
 */
function saveFailed(serverMessage: string | null) {
  toast.error(serverMessage ?? i18n.t("toasts.requestfailed"), { title: i18n.t("toasts.requestfailedtitle") });
}

/**
 * An edit saved in LibrePhotos that ExifTool could not write to the file or its sidecar (#2564), with
 * the server's reason. It stays until closed, and one is up at a time, so rotating ten HEIC photos
 * does not stack ten of them.
 */
function notWrittenToFile(reason: string) {
  toast.warning(i18n.t("toasts.notwrittentofile", { reason }), {
    title: i18n.t("toasts.notwrittentofiletitle"),
    id: "not-written-to-file",
    autoClose: false,
  });
}

/**
 * What failed, by the endpoint a server error came from: the toast names the action ("Couldn't
 * update favorites"), never the path. Any other endpoint gets a plain "Something went wrong".
 */
const SERVER_ERROR_TITLES: Partial<Record<string, ParseKeys>> = {
  "/photosedit/favorite/": "toasts.servererrortitles.favorite",
  "/photosedit/rating/": "toasts.servererrortitles.rating",
  "/photosedit/hide/": "toasts.servererrortitles.hide",
  "/photosedit/archive/": "toasts.servererrortitles.archive",
  "/photosedit/setdeleted/": "toasts.servererrortitles.trash",
  "/photosedit/makepublic/": "toasts.servererrortitles.public",
  "/photosedit/share/": "toasts.servererrortitles.share",
  "/photosedit/category/": "toasts.servererrortitles.category",
  "/photosedit/datetime/": "toasts.servererrortitles.date",
  "/photosedit/location/": "toasts.servererrortitles.location",
  "/photosedit/rotate/": "toasts.servererrortitles.rotate",
  "/photosedit/savecaption/": "toasts.servererrortitles.caption",
};

/**
 * An unhandled exception on the server (HTTP 500), in words a photo user can act on. The endpoint
 * goes to the console for a bug report, not into the toast.
 */
function serverError(endpoint: string) {
  console.error(`Server error (HTTP 500) from ${endpoint}`);
  const { pathname } = new URL(endpoint, window.location.origin);
  const title = SERVER_ERROR_TITLES[pathname] ?? "toasts.servererrortitle";
  toast.error(i18n.t("toasts.servererrorbody"), { title: i18n.t(title) });
}

/**
 * A response that did not match its schema (server drift). The detail is technical: it goes to the
 * console, and one toast at a time says what it means for the user.
 */
function parseError(detail: string) {
  console.error(`Unexpected server response: ${detail}`);
  toast.error(i18n.t("toasts.parseerror"), { title: i18n.t("toasts.parseerrortitle"), id: "parse-error" });
}

export const worker = {
  jobAlreadyRunning,
  jobCancelled,
  jobFinished,
  notWrittenToFile,
  parseError,
  requestFailed,
  saveFailed,
  serverError,
  startDeduplicateFaces,
  startCheckFileContents,
  startLookUpPlaces,
  startStripThumbnailMetadata,
  startTrashPhotosOutsideLibrary,
  startUserPhotoScan,
};
