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
function startLookUpPlaces() {
  toast.success(i18n.t("toasts.lookupplaces"), { title: i18n.t("toasts.lookupplacestitle") });
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

/** An unhandled exception on the server (HTTP 500). The endpoint helps a bug report. */
function serverError(endpoint: string) {
  toast.error(i18n.t("toasts.servererror", { endpoint }), { title: i18n.t("toasts.servererrortitle") });
}

/** A response that did not match its schema; the detail is technical and stays as it is. */
function parseError(detail: string, title?: string) {
  toast.error(i18n.t("toasts.reportissue", { detail }), { title: title ?? i18n.t("toasts.parseerrortitle") });
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
  startLookUpPlaces,
  startStripThumbnailMetadata,
};
