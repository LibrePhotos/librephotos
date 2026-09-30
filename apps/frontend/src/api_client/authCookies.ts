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
export const AUTH_COOKIE_OPTIONS = { path: "/" } as const;

const AUTH_COOKIES = ["access", "refresh", "jwt"] as const;

export function setAuthCookie(name: "access" | "refresh", value: string) {
  new Cookies().set(name, value, AUTH_COOKIE_OPTIONS);
}

export function clearAuthCookies() {
  const cookies = new Cookies();
  for (const name of AUTH_COOKIES) {
    cookies.remove(name, AUTH_COOKIE_OPTIONS);
    // A copy an earlier version scoped to this page's folder.
    cookies.remove(name);
  }
}
