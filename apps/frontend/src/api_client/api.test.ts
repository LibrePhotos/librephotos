/**
 * FetchClient turns a failed response into an ApiError. Only `serverMessage`
 * is safe to show a user, so it must stay null whenever the backend did not
 * actually send a readable message. See issue #492.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchClient } from "./api";

vi.mock("../service/notifications", () => ({
  notification: new Proxy({}, { get: () => () => {} }),
}));

function stubResponse(status: number, body: string | null, contentType = "application/json") {
  const response = new Response(body, {
    status,
    statusText: status === 400 ? "Bad Request" : "Error",
    headers: body === null ? {} : { "Content-Type": contentType },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

async function expectApiError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the request to reject");
}

describe("FetchClient error handling", () => {
  beforeEach(() => {
    // jsdom defaults to about:blank, and handleError reads window.location.pathname
    window.history.pushState({}, "", "/settings");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the first message from a DRF errors body", async () => {
    stubResponse(
      400,
      JSON.stringify({
        errors: [
          { field: "scan_directory", message: "Scan directory does not exist" },
          { field: "auth", message: "a long DEBUG help paragraph that is not for users" },
        ],
      })
    );

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(400);
    expect(error.serverMessage).toBe("Scan directory does not exist");
    expect(error.message).toBe("Scan directory does not exist");
  });

  it("falls back to the detail field", async () => {
    stubResponse(403, JSON.stringify({ detail: "You do not have permission." }));

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(403);
    expect(error.serverMessage).toBe("You do not have permission.");
  });

  it("leaves serverMessage null for an empty body", async () => {
    stubResponse(400, null);

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(400);
    expect(error.serverMessage).toBeNull();
    expect(error.message).toBe("API error: 400 Bad Request");
  });

  it("leaves serverMessage null for a non-JSON body", async () => {
    stubResponse(502, "<html>Bad Gateway</html>", "text/html");

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(502);
    expect(error.serverMessage).toBeNull();
  });

  it("reports a 500 without a server message, so callers do not show its internal string", async () => {
    stubResponse(500, JSON.stringify({ errors: [{ field: "detail", message: "boom" }] }));

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(500);
    expect(error.serverMessage).toBeNull();
  });
});

function fakeJwt(expSecondsFromNow: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp })}.signature`;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookies() {
  document.cookie.split(";").forEach(cookie => {
    const name = cookie.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

type FetchCall = { url: string; init: RequestInit };
type Route = (call: FetchCall) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Stub fetch, routing by the first matching URL predicate; anything unmatched
 * gets a 200 JSON body. Returns the recorded calls.
 */
function stubFetch(routes: Array<[(url: string) => boolean, Route]> = []) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url: String(url), init };
      calls.push(call);
      const match = routes.find(([matches]) => matches(call.url));
      return match ? match[1](call) : json({ ok: true });
    })
  );
  return calls;
}

const endsWith = (suffix: string) => (url: string) => url.endsWith(suffix);

/** Resolve after a macrotask so concurrent callers all reach the refresh before it settles. */
const later = <T>(value: T) =>
  new Promise<T>(resolve => {
    setTimeout(() => resolve(value), 10);
  });

async function freshClient() {
  // FetchClient keeps module-level state (in-flight refresh, logout guard).
  vi.resetModules();
  return import("./api");
}

describe("FetchClient token refresh", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/settings");
    clearCookies();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCookies();
  });

  it("shares one refresh between concurrent requests with an expired token", async () => {
    const { fetchClient: client } = await freshClient();
    setCookie("access", fakeJwt(-60));
    setCookie("refresh", "refresh-token");
    const newAccess = fakeJwt(300);
    const calls = stubFetch([[endsWith("/auth/token/refresh/"), () => later(json({ access: newAccess }))]]);

    await Promise.all(Array.from({ length: 5 }, (_, i) => client.get(`/photos/${i}/`)));

    expect(calls.filter(call => call.url.endsWith("/auth/token/refresh/"))).toHaveLength(1);
    const photoCalls = calls.filter(call => call.url.includes("/photos/"));
    expect(photoCalls).toHaveLength(5);
    photoCalls.forEach(call => {
      expect(new Headers(call.init.headers).get("Authorization")).toBe(`Bearer ${newAccess}`);
    });
  });

  it("shares one refresh between concurrent requests that get a 401", async () => {
    const { fetchClient: client } = await freshClient();
    setCookie("access", fakeJwt(300));
    setCookie("refresh", "refresh-token");
    const newAccess = fakeJwt(600);
    // The first attempt of every photo request is rejected, the retry succeeds.
    const rejected = new Set<string>();
    const calls = stubFetch([
      [endsWith("/auth/token/refresh/"), () => later(json({ access: newAccess }))],
      [
        url => url.includes("/photos/") && !rejected.has(url),
        ({ url }) => {
          rejected.add(url);
          return json({ detail: "expired" }, 401);
        },
      ],
    ]);

    await Promise.all(Array.from({ length: 5 }, (_, i) => client.get(`/photos/${i}/`)));

    expect(calls.filter(call => call.url.endsWith("/auth/token/refresh/"))).toHaveLength(1);
    const photoCalls = calls.filter(call => call.url.includes("/photos/"));
    expect(photoCalls).toHaveLength(10);
    photoCalls.slice(5).forEach(call => {
      expect(new Headers(call.init.headers).get("Authorization")).toBe(`Bearer ${newAccess}`);
    });
  });

  it("refreshes again once the previous refresh has settled", async () => {
    const { fetchClient: client } = await freshClient();
    setCookie("access", fakeJwt(-60));
    setCookie("refresh", "refresh-token");
    // The refreshed token is itself already expired, so the next wave refreshes again.
    const calls = stubFetch([[endsWith("/auth/token/refresh/"), () => later(json({ access: fakeJwt(-30) }))]]);

    await Promise.all([client.get("/a/"), client.get("/b/")]);
    await Promise.all([client.get("/c/"), client.get("/d/")]);

    expect(calls.filter(call => call.url.endsWith("/auth/token/refresh/"))).toHaveLength(2);
  });

  it("logs out only once when concurrent requests fail authentication", async () => {
    const { fetchClient: client, ApiError: FreshApiError } = await freshClient();
    setCookie("access", fakeJwt(300));
    setCookie("refresh", "refresh-token");
    const calls = stubFetch([
      [endsWith("/auth/token/refresh/"), () => later(json({ detail: "invalid" }, 401))],
      [endsWith("/auth/token/blacklist/"), () => later(json({}))],
      [url => url.includes("/photos/"), () => json({ detail: "expired" }, 401)],
    ]);

    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => client.get(`/photos/${i}/`)));

    results.forEach(result => {
      expect(result.status).toBe("rejected");
      const { reason } = result as PromiseRejectedResult;
      expect(reason).toBeInstanceOf(FreshApiError);
      expect(reason.status).toBe(401);
    });
    expect(calls.filter(call => call.url.endsWith("/auth/token/refresh/"))).toHaveLength(1);
    expect(calls.filter(call => call.url.endsWith("/auth/token/blacklist/"))).toHaveLength(1);
  });

  it("does not try to refresh when a login attempt is rejected", async () => {
    const { fetchClient: client } = await freshClient();
    window.history.pushState({}, "", "/login");
    setCookie("refresh", "stale-refresh-token");
    const calls = stubFetch([
      [endsWith("/auth/token/obtain/"), () => json({ detail: "No active account" }, 401)],
      [endsWith("/auth/token/blacklist/"), () => json({})],
    ]);

    await expect(client.post("/auth/token/obtain/", { username: "u", password: "p" })).rejects.toMatchObject({
      status: 401,
    });

    expect(calls.filter(call => call.url.endsWith("/auth/token/refresh/"))).toHaveLength(0);
  });
});

describe("FetchClient request bodies", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/settings");
    clearCookies();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves Content-Type unset for FormData so the browser adds the boundary", async () => {
    const calls = stubFetch();
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.jpg");

    await fetchClient.post("/upload/", form);

    expect(calls[0].init.body).toBe(form);
    expect(new Headers(calls[0].init.headers).has("Content-Type")).toBe(false);
  });

  it("sends a JSON Content-Type for a string body that mentions FormData", async () => {
    const calls = stubFetch();

    await fetchClient.request("/photos/edit/", { method: "POST", body: JSON.stringify({ caption: "FormData" }) });

    expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/json");
  });

  it("serializes plain objects as JSON", async () => {
    const calls = stubFetch();

    await fetchClient.post("/photos/edit/", { caption: "hi" });

    expect(calls[0].init.body).toBe(JSON.stringify({ caption: "hi" }));
    expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/json");
  });
});

describe("FetchClient response types", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/settings");
    clearCookies();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a Blob when asked, whatever the content type", async () => {
    stubFetch([
      [
        endsWith("/serverlogs"),
        () => new Response("log line", { status: 200, headers: { "Content-Type": "text/plain" } }),
      ],
    ]);

    const blob = await fetchClient.getBlob("/serverlogs");

    // Not toBeInstanceOf(Blob): undici's Blob and jsdom's are different classes.
    expect(typeof blob).toBe("object");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("log line");
  });

  it("does not forward responseType to fetch", async () => {
    const calls = stubFetch();

    await fetchClient.getBlob("/serverlogs");

    expect(calls[0].url).toBe("/api/serverlogs");
    expect(calls[0].init).not.toHaveProperty("responseType");
  });
});
