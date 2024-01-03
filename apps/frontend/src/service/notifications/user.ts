import { showNotification } from "@mantine/notifications";

import i18n from "../../i18n";

function updateUser(username: string) {
  showNotification({
    message: i18n.t("toasts.updateuser", { username }),
    title: i18n.t("toasts.updateusertitle"),
    color: "teal",
  });
}

export const user = {
  updateUser,
};
