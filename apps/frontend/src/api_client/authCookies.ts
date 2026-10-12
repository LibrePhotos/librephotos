import { Cookies } from "react-cookie";

/**
 * The web keeps its JWTs in script-readable cookies, and every one of them
 * lives at the site root.
 *
 * A cookie set without a path is scoped by the browser to the folder of the
 * page that set it. A token refreshed while browsing `/search/...` became a
 * second `access` cookie at `/search`, next to the one login left at `/`; and a
 * cookie removed without a path is removed only from the current folder. So
 * logging out from `/search/...` left the `/` token in place, the next request
 * sent it, and the app was signed straight back in -- until a logout happened
 * to be made from the right page.
 */
const AUTH_COOKIE_PATH = "/";

/**
 * The flags of the `access` and `refresh` cookies, the same as the server
 * gives them (apps/backend/api/auth_cookies.py): at `/`, `SameSite=Lax`, so
 * they stay off cross-site subrequests and POSTs, and `Secure` on a page
 * served over HTTPS, so they never travel over plain HTTP. Not `Secure` on a
 * plain-HTTP page, where the browser would refuse the cookie.
 *
 * They cannot be `HttpOnly`: the web reads them to send them as bearer tokens.
 */
export function authCookieOptions(protocol: string = window.location.protocol) {
  return { path: AUTH_COOKIE_PATH, sameSite: "lax", secure: protocol === "https:" } as const;
}

/**
 * The server sets `jwt` HttpOnly now and clears it on logout; removing it here
 * still clears a script-readable copy an older version set.
 */
const AUTH_COOKIES = ["access", "refresh", "jwt"] as const;

/**
 * Every folder an earlier version could have left a copy in that this page
 * can see: `/` and each folder above the page, down to its own. On
 * `/librephotos/search/x` that is `/`, `/librephotos` and
 * `/librephotos/search`.
 *
 * The browser scopes a cookie set without a path to the page's folder: the
 * path up to, but not including, its last `/` (or `/` itself when that is the
 * only one). A page sees the cookies of its own folder and of every folder
 * above it, so a copy made on any of those pages -- the login page of a
 * subpath install at `/librephotos`, say -- is one of these.
 */
function visibleCookieFolders() {
  const folders: string[] = [AUTH_COOKIE_PATH];
  let folder = "";
  // Drop the leading "" and the page's own name: what is left are the folders.
  for (const segment of window.location.pathname.split("/").slice(1, -1)) {
    folder += `/${segment}`;
    folders.push(folder);
  }
  return folders;
}

/**
 * A JWT cookie's value, or undefined when it is not set. The cookie library
 * returns whatever it parsed; a token is never JSON, so it stays a string.
 */
export function getAuthCookie(name: "access" | "refresh"): string | undefined {
  const value: unknown = new Cookies().get(name);
  return typeof value === "string" ? value : undefined;
}

export function setAuthCookie(name: "access" | "refresh", value: string) {
  const cookies = new Cookies();
  // A copy an earlier version scoped to a folder is listed before the `/` one
  // on this page -- longer paths come first -- and would be read instead of
  // the fresh token.
  for (const folder of visibleCookieFolders().slice(1)) {
    cookies.remove(name, { path: folder });
  }
  cookies.set(name, value, authCookieOptions());
}

export function clearAuthCookies() {
  const cookies = new Cookies();
  for (const name of AUTH_COOKIES) {
    // The `/` cookie, and any copy an earlier version left above this page.
    for (const folder of visibleCookieFolders()) {
      cookies.remove(name, { path: folder });
    }
  }
}
