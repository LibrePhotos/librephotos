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

export const worker = {
  jobCancelled,
  jobFinished,
  requestFailed,
};
