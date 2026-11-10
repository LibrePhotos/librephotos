/**
 * The page's cookies, read and written through `document.cookie`: only what the auth cookies
 * (authCookies.ts) need. It replaced react-cookie (universal-cookie 8 over `cookie` 1) and writes
 * the same `Set-Cookie` strings for the same calls, so a token stored by the old code is read and
 * removed exactly as before (documentCookie.test.ts pins the strings).
 */

/** What a cookie is scoped and sent with. `secure` and `sameSite` matter only when it is written. */
type CookieAttributes = {
  path: string;
  sameSite?: "lax";
  secure?: boolean;
  /** Absent: a session cookie, gone when the browser closes. */
  expires?: Date;
};

/**
 * A path a `Path=` attribute can carry (`cookie`'s rule): printable ASCII without `;`, which would
 * end the attribute and start another, and without `<`.
 */
const COOKIE_PATH = /^[ -:=-~]*$/;

/** Space and tab, the whitespace `cookie` trims around a name and a value. */
const EDGE_WHITESPACE = /^[ \t]+|[ \t]+$/g;

/** Percent-decodes a value, or keeps it as it is when it is not valid percent-encoding. */
function decode(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The value of the first cookie called `name` the page sees, decoded; undefined when there is none.
 * The browser lists cookies with a longer path first, so a copy scoped to this page's folder is
 * read before the `/` one.
 */
export function readCookie(name: string): string | undefined {
  for (const pair of document.cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).replace(EDGE_WHITESPACE, "") !== name) continue;
    return decode(pair.slice(separator + 1).replace(EDGE_WHITESPACE, ""));
  }
  return undefined;
}

function pathAttribute(path: string): string {
  if (!COOKIE_PATH.test(path)) throw new TypeError(`cookie path is invalid: ${path}`);
  return `; Path=${path}`;
}

/** The `Set-Cookie` string that stores `value` (percent-encoded) under `name`. */
function serializeCookie(name: string, value: string, { path, sameSite, secure, expires }: CookieAttributes) {
  let cookie = `${name}=${encodeURIComponent(value)}${pathAttribute(path)}`;
  // An invalid date would write `Expires=Invalid Date`; such a cookie stays a session cookie.
  if (expires !== undefined && Number.isFinite(expires.getTime())) cookie += `; Expires=${expires.toUTCString()}`;
  if (secure) cookie += "; Secure";
  if (sameSite === "lax") cookie += "; SameSite=Lax";
  return cookie;
}

export function writeCookie(name: string, value: string, attributes: CookieAttributes) {
  document.cookie = serializeCookie(name, value, attributes);
}

/**
 * The `Set-Cookie` string that removes the cookie called `name` at `path`: empty, `Max-Age=0` and
 * an expiry in the past, the attributes react-cookie's remove wrote (its date was 1 Feb 1970 in
 * local time; any past date removes the cookie).
 */
function serializeCookieRemoval(name: string, path: string) {
  return `${name}=; Max-Age=0${pathAttribute(path)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Removes the cookie called `name` at exactly `path`; one at another path stays. */
export function removeCookie(name: string, path: string) {
  document.cookie = serializeCookieRemoval(name, path);
}

/** Whether a path can be named in a cookie attribute at all (see COOKIE_PATH). */
export function isCookiePath(path: string): boolean {
  return COOKIE_PATH.test(path);
}
