import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../transport";
import type { TokenSupplier } from "../transport";

/** A non-expiring JWT (exp far in the future) so the proactive refresh path is skipped. */
const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") +
  ".sig";
/** An already-expired JWT (exp in the past) to trigger proactive refresh. */
const EXPIRED_JWT =
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ exp: 1, user_id: 1 })).toString("base64url") + ".sig";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a fetch-compatible mock from a (url, init) handler. */
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
}

function makeTokens(overrides?: Partial<Record<keyof TokenSupplier, unknown>>) {
  const store = { access: FUTURE_JWT as string | null, refresh: "refresh-1" as string | null };
  const tokens: TokenSupplier = {
    getAccessToken: vi.fn(() => store.access),
    getRefreshToken: vi.fn(() => store.refresh),
    setAccessToken: vi.fn((t: string) => {
      store.access = t;
    }),
    clearTokens: vi.fn(() => {
      store.access = null;
      store.refresh = null;
    }),
    ...(overrides as object),
  };
  return { tokens, store };
}

describe("createApiClient transport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefixes baseUrl with /api and attaches the bearer token", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ ok: true }));
    const { tokens } = makeTokens();
    const client = createApiClient({ baseUrl: "https://demo.example.com/", tokens, fetch: fetchMock });

    const data = await client.get<{ ok: boolean }>("/user/1/");

    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://demo.example.com/api/user/1/");
    expect(new Headers(init!.headers).get("Authorization")).toBe(`Bearer ${FUTURE_JWT}`);
  });

  it("JSON-encodes object bodies and sets Content-Type", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ id: 9 }));
    const { tokens } = makeTokens();
    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens, fetch: fetchMock });

    await client.post("/albums/user/", { title: "Trip" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ title: "Trip" }));
    expect(new Headers(init!.headers).get("Content-Type")).toBe("application/json");
  });

  it("refreshes proactively when the access token is about to expire", async () => {
    const { tokens, store } = makeTokens();
    store.access = EXPIRED_JWT;
    const fetchMock = mockFetch(async (url: string) => {
      if (url.endsWith("/auth/token/refresh/")) return jsonResponse({ access: FUTURE_JWT });
      return jsonResponse({ ok: true });
    });
    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens, fetch: fetchMock });

    await client.get("/photos/recentlyadded/");

    expect(tokens.setAccessToken).toHaveBeenCalledWith(FUTURE_JWT);
    const dataCall = fetchMock.mock.calls.find(([u]) => (u as string).includes("/photos/recentlyadded/"))!;
    expect(new Headers((dataCall[1] as RequestInit).headers).get("Authorization")).toBe(`Bearer ${FUTURE_JWT}`);
  });

  it("reactively refreshes + retries once on a 401", async () => {
    const { tokens } = makeTokens();
    let calls = 0;
    const fetchMock = mockFetch(async (url: string) => {
      if (url.endsWith("/auth/token/refresh/")) return jsonResponse({ access: FUTURE_JWT });
      calls += 1;
      return calls === 1 ? jsonResponse({ detail: "expired" }, 401) : jsonResponse({ ok: true });
    });
    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens, fetch: fetchMock });

    const data = await client.get<{ ok: boolean }>("/user/1/");
    expect(data).toEqual({ ok: true });
    expect(tokens.setAccessToken).toHaveBeenCalledWith(FUTURE_JWT);
  });

  it("clears tokens and fires onAuthError when refresh fails on a 401", async () => {
    const { tokens } = makeTokens();
    const onAuthError = vi.fn();
    const fetchMock = mockFetch(async (url: string) => {
      if (url.endsWith("/auth/token/refresh/")) return jsonResponse({ detail: "bad" }, 401);
      return jsonResponse({ detail: "expired" }, 401);
    });
    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens, fetch: fetchMock, onAuthError });

    await expect(client.get("/user/1/")).rejects.toBeInstanceOf(ApiError);
    expect(tokens.clearTokens).toHaveBeenCalled();
    expect(onAuthError).toHaveBeenCalled();
  });

  it("supports a function baseUrl (runtime server URL change)", async () => {
    let base = "https://one.example.com";
    const fetchMock = mockFetch(async () => jsonResponse({ ok: true }));
    const { tokens } = makeTokens();
    const client = createApiClient({ baseUrl: () => base, tokens, fetch: fetchMock });

    await client.get("/x");
    base = "https://two.example.com";
    await client.get("/x");

    expect(fetchMock.mock.calls[0]![0]).toBe("https://one.example.com/api/x");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://two.example.com/api/x");
  });
});

describe("createApiClient errors", () => {
  const client = (response: Response, extra: Partial<Parameters<typeof createApiClient>[0]> = {}) =>
    createApiClient({
      baseUrl: "https://demo.example.com",
      tokens: makeTokens().tokens,
      fetch: mockFetch(async () => response.clone()),
      ...extra,
    });

  async function rejection(promise: Promise<unknown>): Promise<ApiError> {
    const error = await promise.then(
      () => {
        throw new Error("expected the request to reject");
      },
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  it("takes serverMessage from the first DRF errors[] message", async () => {
    const response = jsonResponse(
      { errors: [{ field: "scan_directory", message: "Scan directory does not exist" }, { message: "DEBUG help" }] },
      400
    );
    const error = await rejection(client(response).get("/manage/user/1/"));
    expect(error.status).toBe(400);
    expect(error.endpoint).toBe("/manage/user/1/");
    expect(error.serverMessage).toBe("Scan directory does not exist");
    expect(error.message).toBe("API error: 400 ");
  });

  it("falls back to a string detail", async () => {
    const error = await rejection(client(jsonResponse({ detail: "No permission." }, 403)).get("/x/"));
    expect(error.serverMessage).toBe("No permission.");
    expect(error.body).toEqual({ detail: "No permission." });
  });

  it("leaves serverMessage null for an empty or non-JSON body", async () => {
    const empty = await rejection(client(new Response(null, { status: 400 })).get("/x/"));
    expect(empty.serverMessage).toBeNull();
    const html = await rejection(
      client(new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })).get(
        "/x/"
      )
    );
    expect(html.serverMessage).toBeNull();
  });

  it("never reports a server message for a 500, and hands onServerError a readable response", async () => {
    const onServerError = vi.fn(async (_endpoint: string, response: Response) => response.json());
    const error = await rejection(
      client(jsonResponse({ errors: [{ message: "boom" }] }, 500), { onServerError }).get("/x/")
    );
    expect(error.serverMessage).toBeNull();
    expect(onServerError).toHaveBeenCalledWith("/x/", expect.any(Response));
    await expect(onServerError.mock.results[0]!.value).resolves.toEqual({ errors: [{ message: "boom" }] });
  });

  it("lets onUnauthorized replace the default 401 handling, for the login endpoint too", async () => {
    const { tokens } = makeTokens();
    const onAuthError = vi.fn();
    const seen: unknown[] = [];
    const onUnauthorized = vi.fn(async (endpoint: string, response: Response) => {
      seen.push([endpoint, await response.json()]);
    });
    const fetchMock = mockFetch(async () => jsonResponse({ detail: "No active account" }, 401));
    const api = createApiClient({
      baseUrl: "https://demo.example.com",
      tokens,
      fetch: fetchMock,
      onAuthError,
      onUnauthorized,
    });

    const error = await rejection(api.post("/auth/token/obtain/", { username: "u", password: "p" }));

    expect(error.status).toBe(401);
    expect(seen).toEqual([["/auth/token/obtain/", { detail: "No active account" }]]);
    expect(tokens.clearTokens).not.toHaveBeenCalled();
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it("rejects with the error onUnauthorized throws", async () => {
    const boom = new Error("logged out");
    const api = client(jsonResponse({}, 401), {
      onUnauthorized: () => {
        throw boom;
      },
    });
    await expect(api.get("/auth/token/obtain/")).rejects.toBe(boom);
  });
});

describe("createApiClient bodies and response types", () => {
  function harness(response: () => Response = () => jsonResponse({ ok: true })) {
    const fetchMock = mockFetch(async () => response());
    const api = createApiClient({ baseUrl: "", tokens: makeTokens().tokens, fetch: fetchMock });
    return { api, fetchMock };
  }

  it("sends a JSON Content-Type for a string body", async () => {
    const { api, fetchMock } = harness();
    await api.request("/photos/edit/", { method: "POST", body: JSON.stringify({ caption: "FormData" }) });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ caption: "FormData" }));
    expect(new Headers(init!.headers).get("Content-Type")).toBe("application/json");
  });

  it("keeps an explicit Content-Type for a string body", async () => {
    const { api, fetchMock } = harness();
    await api.request("/x/", { method: "POST", body: "a=b", headers: { "Content-Type": "text/plain" } });
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get("Content-Type")).toBe("text/plain");
  });

  it("leaves Content-Type unset for FormData so the runtime adds the boundary", async () => {
    const { api, fetchMock } = harness();
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.jpg");
    await api.post("/upload/", form);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(form);
    expect(new Headers(init!.headers).has("Content-Type")).toBe(false);
  });

  it("returns a Blob from getBlob whatever the Content-Type, without forwarding responseType", async () => {
    const { api, fetchMock } = harness(
      () => new Response("log line", { status: 200, headers: { "content-type": "text/plain" } })
    );
    const blob = await api.getBlob("/serverlogs");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("log line");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/serverlogs");
    expect(init).not.toHaveProperty("responseType");
  });

  it("returns text when asked, even for a JSON response", async () => {
    const { api } = harness();
    await expect(api.request("/x/", { responseType: "text" })).resolves.toBe(JSON.stringify({ ok: true }));
  });

  it("uses the global fetch at call time when none is injected", async () => {
    const api = createApiClient({ baseUrl: "https://demo.example.com", tokens: makeTokens().tokens });
    const stub = mockFetch(async () => jsonResponse({ late: true }));
    vi.stubGlobal("fetch", stub);
    try {
      await expect(api.get("/x/")).resolves.toEqual({ late: true });
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
