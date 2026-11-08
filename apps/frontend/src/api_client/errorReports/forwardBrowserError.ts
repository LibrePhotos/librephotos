import { endpoints } from "@librephotos/api-client";
import { quietApiClient } from "../api";
import { getAuthCookie } from "../authCookies";

/**
 * Hand a browser error (a Sentry envelope, as text) to the server, which scrubs and saves it and
 * sends it on only when an admin chose a server (#2938). Signed out (the login page, a public
 * album), there is nobody the server takes it from, so nothing is sent. True when it was.
 */
export async function forwardBrowserError(envelope: string): Promise<boolean> {
  if (getAuthCookie("refresh") === undefined && getAuthCookie("access") === undefined) {
    return false;
  }
  await endpoints.forwardBrowserErrorReport(quietApiClient, envelope);
  return true;
}
