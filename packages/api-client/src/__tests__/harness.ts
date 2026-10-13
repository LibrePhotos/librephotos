import { vi } from "vitest";
import { createApiClient } from "../transport";
import type { ApiClient } from "../transport";

const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") + ".sig";

/** One request an endpoint sent: what the fixture tests check besides the parsed answer. */
export type SentRequest = { url: string; method: string; body: unknown };

/**
 * A client whose server answers every request with `body` (JSON, or no body for `null` with 204),
 * and the requests it got. Tokens are a valid access token and refresh token "r".
 */
export function fakeServer(body: unknown, status = 200): { client: ApiClient; requests: SentRequest[] } {
  return fakeServerByUrl(() => body, status);
}

/** fakeServer whose answer depends on the requested URL (one page of a list per `?page=`). */
export function fakeServerByUrl(
  answer: (url: string) => unknown,
  status = 200
): { client: ApiClient; requests: SentRequest[] } {
  const requests: SentRequest[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw,
    });
    const body = answer(String(input));
    const response =
      body === null
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    return Promise.resolve(response);
  });
  const client = createApiClient({
    baseUrl: "https://demo.example.com",
    tokens: {
      getAccessToken: () => FUTURE_JWT,
      getRefreshToken: () => "r",
      setAccessToken: () => {},
      clearTokens: () => {},
    },
    fetch: fetchMock,
  });
  return { client, requests };
}
