import { Alert } from "@mantine/core";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ssoErrorMessageKey } from "../../util/ssoErrors";

/**
 * Why the last single sign-on attempt failed, or nothing.
 *
 * The backend redirects to the login page with `?sso_error=<reason>` in a full
 * page load, so the query string is the source of truth; there is no router
 * state to carry the reason. Kept separate from the form so other login notices
 * can sit next to it.
 */
export function SsoErrorAlert(): React.JSX.Element | null {
  const { t } = useTranslation();
  const messageKey = useMemo(
    () => ssoErrorMessageKey(new URLSearchParams(window.location.search).get("sso_error")),
    []
  );
  if (!messageKey) {
    return null;
  }
  return (
    <Alert color="red" variant="light" title={t("login.sso.errortitle")}>
      {t(messageKey)}
    </Alert>
  );
}
