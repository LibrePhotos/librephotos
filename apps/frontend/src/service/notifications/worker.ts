import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";

function jobFinished(title: string, job: string) {
  showNotification({
    message: i18n.t("toasts.jobfinished", { job }),
    title,
    color: "teal",
  });
}

function jobCancelled() {
  showNotification({
    message: i18n.t("toasts.jobcancelled"),
    title: i18n.t("toasts.jobcancelledtitle"),
    color: "orange",
  });
}

function requestFailed(title: string, message: string) {
  showNotification({
    message,
    title,
    color: "red",
  });
}

/** An unhandled exception on the server (HTTP 500). The endpoint helps a bug report. */
function serverError(endpoint: string) {
  showNotification({
    title: i18n.t("toasts.servererrortitle"),
    message: i18n.t("toasts.servererror", { endpoint }),
    color: "red",
  });
}

/** A response that did not match its schema; the detail is technical and stays as it is. */
function parseError(detail: string, title?: string) {
  showNotification({
    title: title ?? i18n.t("toasts.parseerrortitle"),
    message: i18n.t("toasts.reportissue", { detail }),
    color: "red",
  });
}

export const worker = {
  jobCancelled,
  jobFinished,
  parseError,
  requestFailed,
  serverError,
};
