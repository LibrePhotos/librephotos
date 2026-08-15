/**
 * Reasons the backend bounces a failed SSO attempt back to the login screen with
 * `?sso_error=<reason>`.
 */
const SSO_ERROR_MESSAGE_KEYS: Record<string, string> = {
  signup_disabled: "login.sso.errorsignupdisabled",
  email_not_verified: "login.sso.erroremailnotverified",
  not_authenticated: "login.sso.errornotauthenticated",
  public_url_not_configured: "login.sso.errorpublicurlnotconfigured",
};

/**
 * Translation key for an `sso_error` reason, or null when there is no error.
 *
 * An unrecognised reason still gets a message: a backend newer than the frontend
 * must not be able to leave the user looking at a silently failed login.
 */
export function ssoErrorMessageKey(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  return SSO_ERROR_MESSAGE_KEYS[reason] ?? "login.sso.errorunknown";
}
