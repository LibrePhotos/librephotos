import i18n from "../../i18n";
import { toast } from "./toast";

function jobFinished(title: string, job: string) {
  toast.success(i18n.t("toasts.jobfinished", { job }), { title });
}

function jobCancelled() {
  toast.warning(i18n.t("toasts.jobcancelled"), { title: i18n.t("toasts.jobcancelledtitle") });
}

function requestFailed(title: string, message: string) {
  toast.error(message, { title });
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
  jobCancelled,
  jobFinished,
  parseError,
  requestFailed,
  serverError,
};
