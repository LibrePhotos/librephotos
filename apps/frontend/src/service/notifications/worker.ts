import { showNotification } from "@mantine/notifications";

import i18n from "../../i18n";

function jobFinished(title: string, job: string) {
  showNotification({
    message: i18n.t("toasts.jobfinished", { job }),
    title,
    color: "teal",
  });
}

export const worker = {
  jobFinished,
};
