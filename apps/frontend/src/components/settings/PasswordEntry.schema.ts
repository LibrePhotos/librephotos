import type { TFunction } from "i18next";

/** What the password fields say, for `withNewPassword` in the schema of the form that holds them. */
export function passwordMessages(t: TFunction) {
  return {
    blank: t("settings.password.errorcannotbeblank"),
    retype: t("settings.password.errormustretype"),
    mismatch: t("settings.password.errormustmatch"),
  };
}
