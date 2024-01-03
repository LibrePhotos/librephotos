import { showNotification } from "@mantine/notifications";

import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";

function authError(isLogin: boolean, field: string, display: string) {
  const message = isLogin && i18n.exists(`login.error${field}`) ? i18n.t(`login.error${field}`) : display;

  showNotification({
    message,
    title: toUpperCase(field),
    color: "red",
  });
}

function invalidToken() {
  showNotification({
    message: i18n.t("login.error.token_not_valid"),
    title: i18n.t("login.error.token"),
    color: "red",
  });
}

export const auth = {
  authError,
  invalidToken,
};
