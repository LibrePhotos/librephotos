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
