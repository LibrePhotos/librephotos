/**
 * Logging out from any page ends the session.
 *
 * The auth cookies used to be set and removed without a path, which the
 * browser scopes to the current page's folder: a token refreshed on
 * `/search/...` became a second `access` cookie there, and a logout made from
 * that page removed only that one, leaving login's `/` token to sign the user
 * straight back in. jsdom scopes cookies by path the way a browser does, so the
 * sequence is replayed here page by page.
 */
import { Cookies } from "react-cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromUnixSeconds } from "../util/dateUtils";
import { authCookieOptions, clearAuthCookies, setAuthCookie } from "./authCookies";

function visit(path: string) {
  window.history.pushState({}, "", path);
}

function accessCookies() {
  return document.cookie
    .split("; ")
    .filter(cookie => cookie.startsWith("access="))
    .sort();
}

afterEach(() => {
  for (const path of ["/", "/search", "/search/deep", "/login", "/librephotos", "/librephotos/search"]) {
    visit(`${path === "/" ? "" : path}/x`);
    for (const name of ["access", "refresh", "jwt"]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}`;
    }
  }
  visit("/");
});

describe("auth cookie options", () => {
  it("keeps the tokens at the root, off cross-site requests", () => {
    expect(authCookieOptions("http:")).toEqual({ path: "/", sameSite: "lax", secure: false });
  });

  it("marks them Secure on a page served over HTTPS", () => {
    expect(authCookieOptions("https:")).toEqual({ path: "/", sameSite: "lax", secure: true });
  });

  it("follows the page's own scheme by default", () => {
    // jsdom serves the tests from http://localhost, a plain-HTTP LAN install's case.
    expect(authCookieOptions().secure).toBe(false);
  });
});

describe("auth cookies", () => {
  it("keeps one token however deep the page that refreshed it", () => {
    visit("/login");
    setAuthCookie("access", "from-login");
    visit("/search/hdr_hlg_hevc");
    setAuthCookie("access", "refreshed");

    expect(accessCookies()).toEqual(["access=refreshed"]);
  });

  it("logs out from a page in a folder", () => {
    visit("/login");
    setAuthCookie("access", "from-login");
    setAuthCookie("refresh", "refresh-token");
    visit("/search/hdr_hlg_hevc");
    setAuthCookie("access", "refreshed");

    clearAuthCookies();

    expect(document.cookie).toBe("");
  });

  it("also clears a copy an older version left in this page's folder", () => {
    visit("/search/hdr_hlg_hevc");
    // What the old code did: no path, so the browser scoped it to /search.
    new Cookies().set("access", "old-scoped");

    clearAuthCookies();

    expect(accessCookies()).toEqual([]);
  });

  it("also clears a copy an older version left in a folder above this page", () => {
    visit("/search/hdr_hlg_hevc");
    new Cookies().set("access", "old-scoped");
    visit("/search/deep/page");

    clearAuthCookies();

    expect(accessCookies()).toEqual([]);
  });

  it("logs out of a subpath install from a page in a folder", () => {
    // VITE_PUBLIC_URL=/librephotos: the old login page scoped its copy to
    // /librephotos, a refresh on a search page to /librephotos/search.
    visit("/librephotos/login");
    new Cookies().set("access", "old-login");
    new Cookies().set("refresh", "old-refresh");
    visit("/librephotos/search/hdr_hlg_hevc");
    new Cookies().set("access", "old-refreshed");
    setAuthCookie("refresh", "refresh-token");

    clearAuthCookies();

    expect(document.cookie).toBe("");
  });

  it("reads the fresh token on a page an older version left a copy on", () => {
    visit("/search/hdr_hlg_hevc");
    new Cookies().set("access", "old-scoped");

    setAuthCookie("access", "refreshed");

    expect(accessCookies()).toEqual(["access=refreshed"]);
    expect(new Cookies().get("access")).toBe("refreshed");
  });

  it("was broken with the old calls, which is what this pins", () => {
    visit("/login");
    new Cookies().set("access", "from-login");
    visit("/search/hdr_hlg_hevc");
    new Cookies().set("access", "refreshed");

    new Cookies().remove("access");

    expect(accessCookies()).toEqual(["access=from-login"]);
  });
});

/** An unsigned JWT with these claims: the cookie code only decodes, it never verifies. */
function token(claims: Record<string, unknown>): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.signature`;
}

describe("auth cookie lifetime (Remember me, #2024)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function optionsOfSet(name: "access" | "refresh", value: string) {
    const set = vi.spyOn(Cookies.prototype, "set");
    setAuthCookie(name, value);
    expect(set).toHaveBeenCalledTimes(1);
    return set.mock.calls[0]?.[2];
  }

  it("keeps a remembered sign-in's tokens until the sign-in ends", () => {
    const until = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    for (const name of ["access", "refresh"] as const) {
      expect(optionsOfSet(name, token({ exp: until, remember_until: until }))).toEqual({
        path: "/",
        sameSite: "lax",
        secure: false,
        expires: fromUnixSeconds(until).toJSDate(),
      });
      vi.restoreAllMocks();
    }
  });

  it("leaves a plain sign-in's tokens as session cookies", () => {
    expect(optionsOfSet("access", token({ exp: 1 }))?.expires).toBeUndefined();
  });

  it("ignores a claim that is not a number", () => {
    expect(optionsOfSet("access", token({ remember_until: "soon" }))?.expires).toBeUndefined();
  });

  it("stores a value that is not a JWT as a session cookie", () => {
    expect(optionsOfSet("access", "from-login")?.expires).toBeUndefined();
  });

  it("is still read back after a remembered sign-in", () => {
    const value = token({ remember_until: Math.floor(Date.now() / 1000) + 60 });

    setAuthCookie("access", value);

    expect(new Cookies().get("access")).toBe(value);
  });
});
