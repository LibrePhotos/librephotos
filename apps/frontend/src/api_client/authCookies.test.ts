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
import { afterEach, describe, expect, it } from "vitest";
import { clearAuthCookies, setAuthCookie } from "./authCookies";

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
  for (const path of ["/", "/search", "/login"]) {
    visit(`${path === "/" ? "" : path}/x`);
    for (const name of ["access", "refresh", "jwt"]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}`;
    }
  }
  visit("/");
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

  it("was broken with the old calls, which is what this pins", () => {
    visit("/login");
    new Cookies().set("access", "from-login");
    visit("/search/hdr_hlg_hevc");
    new Cookies().set("access", "refreshed");

    new Cookies().remove("access");

    expect(accessCookies()).toEqual(["access=from-login"]);
  });
});
