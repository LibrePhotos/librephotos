import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";

function updateUser(username: string) {
  showNotification({
    message: i18n.t("toasts.updateuser", { username }),
    title: i18n.t("toasts.updateusertitle"),
    color: "teal",
  });
}

function updateUserError(message?: string) {
  showNotification({
    message: message || i18n.t("toasts.updateusererror"),
    title: i18n.t("toasts.updateusererrortitle"),
    color: "red",
  });
}

function signupError(message?: string) {
  showNotification({
    message: message || i18n.t("toasts.signuperror"),
    title: i18n.t("toasts.signuperrortitle"),
    color: "red",
  });
}

export const user = {
  updateUser,
  updateUserError,
  signupError,
};
