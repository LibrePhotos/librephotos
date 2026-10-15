import type { ParseKeys } from "i18next";
import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";
import { toast } from "./toast";

// The fields of a refused login that have a message of their own; any other shows the server's text.
const LOGIN_FIELD_ERROR_KEYS: Partial<Record<string, ParseKeys>> = {
  detail: "login.errordetail",
  password: "login.errorpassword",
  username: "login.errorusername",
  email: "login.erroremail",
};

function authError(isLogin: boolean, field: string, display: string) {
  const key = isLogin ? LOGIN_FIELD_ERROR_KEYS[field] : undefined;
  const message = key ? i18n.t(key) : display;

  // A refused login used to be titled with the raw field name ("Detail").
  toast.error(message, { title: isLogin ? i18n.t("login.errortitle") : toUpperCase(field) });
}

function invalidToken() {
  toast.error(i18n.t("login.error.token_not_valid"), { title: i18n.t("login.error.token") });
}

export const auth = {
  authError,
  invalidToken,
};
