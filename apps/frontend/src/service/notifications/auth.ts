import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";
import { toast } from "./toast";

function authError(isLogin: boolean, field: string, display: string) {
  const message = isLogin && i18n.exists(`login.error${field}`) ? i18n.t(`login.error${field}`) : display;

  // A refused login used to be titled with the raw field name ("Detail").
  toast.error(message, { title: isLogin ? i18n.t("login.errortitle") : toUpperCase(field) });
}

function invalidToken() {
  toast.error(i18n.t("login.error.token_not_valid"), { title: i18n.t("login.error.token") });
}

/** The server could not be reached at all, or the proxy answered for it (502-504). */
function backendUnreachable() {
  toast.error(i18n.t("login.errorbackend"), { title: i18n.t("login.errortitle") });
}

export const auth = {
  authError,
  backendUnreachable,
  invalidToken,
};
