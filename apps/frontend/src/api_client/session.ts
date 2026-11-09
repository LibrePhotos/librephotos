import { clearAuthCookies, getAuthCookie } from "./authCookies";
import { loadPage } from "./pageLoad";

const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";

/** The login page's `?session=` value after a session that ran out: it says so in a toast there. */
export const SESSION_EXPIRED = "expired";

/**
 * The tab's session as the transport sees it: `open`, or `ending` once a full page load of the
 * login page is under way. Not a router navigation: the cached "logged in" answer would send /login
 * straight back into the app, and a reload drops every cached query, so whoever signs in next in
 * this tab never sees the previous user's data. While it ends, the 401s of the requests still in
 * flight change nothing; the page load starts this module over.
 */
let phase: "open" | "ending" = "open";

/**
 * Logs out on the server: it blacklists the refresh token, if there still is one, and clears the
 * HttpOnly jwt cookie, which this script cannot delete. api.ts sends it.
 */
type LogOutOnServer = (refreshToken: string | undefined) => Promise<void>;

/** Log out was asked for, and the server told: load the login page. */
export function redirectToLogin(): void {
  phase = "ending";
  loadPage(`${PUBLIC_URL}/login`);
}

/**
 * A 401 the transport could not fix with a token refresh, in the signed-in app: the session ran
 * out. Once per page, however many requests fail: log out on the server, drop the cookies and load
 * the login page, which says why and returns to this page after the sign-in. A toast shown here
 * would be gone with the page.
 */
export async function expireSession(logOutOnServer: LogOutOnServer): Promise<void> {
  if (phase === "ending") return;
  phase = "ending";
  const refreshToken = getAuthCookie("refresh");
  clearAuthCookies();
  await logOutOnServer(refreshToken);
  const { pathname, search } = window.location;
  const query = new URLSearchParams({ session: SESSION_EXPIRED, redirect: pathname + search });
  loadPage(`${PUBLIC_URL}/login?${query.toString()}`);
}

/**
 * A refused sign-in or sign-up on the login or sign-up page ends no session; a stale token left
 * from an earlier one is dropped, and the cookies go first, so a second 401 finds nothing to drop.
 */
export async function dropStaleSession(logOutOnServer: LogOutOnServer): Promise<void> {
  const refreshToken = getAuthCookie("refresh");
  if (!refreshToken) return;
  clearAuthCookies();
  await logOutOnServer(refreshToken);
}
