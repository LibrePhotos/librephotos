import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";

function authError(isLogin: boolean, field: string, display: string) {
  const message = isLogin && i18n.exists(`login.error${field}`) ? i18n.t(`login.error${field}`) : display;

  showNotification({
    message,
    // A refused login used to be titled with the raw field name ("Detail").
    title: isLogin ? i18n.t("login.errortitle") : toUpperCase(field),
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

/** The server could not be reached at all, or the proxy answered for it (502-504). */
function backendUnreachable() {
  showNotification({
    message: i18n.t("login.errorbackend"),
    title: i18n.t("login.errortitle"),
    color: "red",
  });
}

export const auth = {
  authError,
  backendUnreachable,
  invalidToken,
};
