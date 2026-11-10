/**
 * The cookie strings the web writes are the ones react-cookie (universal-cookie 8 over `cookie` 1)
 * wrote for the same calls, captured from that library before it was removed, so a session stored
 * by an older build keeps working and is removed the same way.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromUnixSeconds } from "../util/dateUtils";
import { isCookiePath, readCookie, removeCookie, writeCookie } from "./documentCookie";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZW1lbWJlcl91bnRpbCI6MTgwMDAwMDAwMH0.sig-_x";

/** What `write` sets document.cookie to, in order; jsdom still stores it. */
function recordWrites(write: () => void): string[] {
  const spy = vi.spyOn(Document.prototype, "cookie", "set");
  write();
  const writes = spy.mock.calls.map(([value]) => value);
  spy.mockRestore();
  return writes;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
});

describe("writing a cookie", () => {
  it("writes react-cookie's string for a session token on plain HTTP", () => {
    expect(recordWrites(() => writeCookie("access", TOKEN, { path: "/", sameSite: "lax", secure: false }))).toEqual([
      `access=${TOKEN}; Path=/; SameSite=Lax`,
    ]);
  });

  it("writes react-cookie's string for a remembered token on HTTPS", () => {
    const expires = fromUnixSeconds(1800000000).toJSDate();
    expect(
      recordWrites(() => writeCookie("refresh", TOKEN, { path: "/", sameSite: "lax", secure: true, expires }))
    ).toEqual([`refresh=${TOKEN}; Path=/; Expires=Fri, 15 Jan 2027 08:00:00 GMT; Secure; SameSite=Lax`]);
  });

  it("percent-encodes the value as react-cookie did", () => {
    expect(recordWrites(() => writeCookie("access", "a b;c=d%eé", { path: "/", sameSite: "lax" }))).toEqual([
      "access=a%20b%3Bc%3Dd%25e%C3%A9; Path=/; SameSite=Lax",
    ]);
    expect(readCookie("access")).toBe("a b;c=d%eé");
  });

  it("stores a token as it is: a JWT needs no encoding", () => {
    writeCookie("access", TOKEN, { path: "/", sameSite: "lax" });

    expect(document.cookie).toBe(`access=${TOKEN}`);
    expect(readCookie("access")).toBe(TOKEN);
  });

  it("keeps a cookie with an invalid expiry a session cookie", () => {
    expect(
      recordWrites(() =>
        writeCookie("access", "x", { path: "/", sameSite: "lax", expires: fromUnixSeconds(1e20).toJSDate() })
      )
    ).toEqual(["access=x; Path=/; SameSite=Lax"]);
  });

  it("refuses a path that would start another attribute", () => {
    expect(() => writeCookie("access", "x", { path: "/a;Domain=evil.example" })).toThrow(TypeError);
    expect(() => removeCookie("access", "/a;b")).toThrow(TypeError);
    expect(document.cookie).toBe("");
  });
});

describe("removing a cookie", () => {
  it("writes react-cookie's attributes: empty, Max-Age=0, the path, an expiry in the past", () => {
    expect(recordWrites(() => removeCookie("jwt", "/search"))).toEqual([
      "jwt=; Max-Age=0; Path=/search; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  });

  it("removes the cookie at that path only", () => {
    window.history.pushState({}, "", "/search/x");
    document.cookie = "access=scoped; Path=/search";
    document.cookie = "access=root; Path=/";

    removeCookie("access", "/search");

    expect(document.cookie).toBe("access=root");
    window.history.pushState({}, "", "/");
  });
});

describe("reading a cookie", () => {
  // `cookie`'s parse rules, which react-cookie read with.
  function readFrom(header: string, name: string) {
    vi.spyOn(Document.prototype, "cookie", "get").mockReturnValue(header);
    return readCookie(name);
  }

  it("decodes percent-encoding, and keeps a value that is not valid percent-encoding", () => {
    expect(readFrom("access=x%20y; refresh=a%zz", "access")).toBe("x y");
    expect(readFrom("access=x%20y; refresh=a%zz", "refresh")).toBe("a%zz");
  });

  it("reads the first cookie of that name: the browser lists the longest path first", () => {
    expect(readFrom("access=scoped; access=root", "access")).toBe("scoped");
  });

  it("matches the whole name, not a prefix or a suffix", () => {
    expect(readFrom("access_old=1; xaccess=2; access=3", "access")).toBe("3");
  });

  it("trims spaces and tabs around a name and a value, skips a pair without '='", () => {
    expect(readFrom("bare; \taccess = v \t; empty=", "access")).toBe("v");
    expect(readFrom("bare; empty=", "empty")).toBe("");
    expect(readFrom("bare", "bare")).toBeUndefined();
  });

  it("is undefined for a cookie that is not set", () => {
    expect(readFrom("", "access")).toBeUndefined();
    expect(readFrom("refresh=x", "access")).toBeUndefined();
  });

  it("returns a quoted value with its quotes: a token is never JSON", () => {
    // react-cookie ran JSON.parse on every value first; no token ever parsed as JSON.
    expect(readFrom('access="q"', "access")).toBe('"q"');
  });

  it("reads back through jsdom what it wrote", () => {
    writeCookie("refresh", TOKEN, { path: "/", sameSite: "lax" });
    expect(readCookie("refresh")).toBe(TOKEN);
  });
});

describe("cookie paths", () => {
  it("accepts a folder and refuses one with ';' or '<'", () => {
    expect(isCookiePath("/")).toBe(true);
    expect(isCookiePath("/librephotos/search")).toBe(true);
    expect(isCookiePath("/a;b")).toBe(false);
    expect(isCookiePath("/a<b")).toBe(false);
  });
});
