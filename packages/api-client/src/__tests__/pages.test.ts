import { describe, expect, it, vi } from "vitest";
import { createApiClient, fetchAllPages } from "../transport";
import type { TokenSupplier } from "../transport";
import { ResponseParseError } from "../util/parse";

const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") + ".sig";

const tokens: TokenSupplier = {
  getAccessToken: () => FUTURE_JWT,
  getRefreshToken: () => "r",
  setAccessToken: () => {},
  clearTokens: () => {},
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A client whose server answers each requested URL from `pages`; records the URLs. */
function serve(pages: Record<string, unknown>) {
  const urls: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (!(url in pages)) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(jsonResponse(pages[url]));
  });
  const client = createApiClient({ baseUrl: "https://photos.example.com", tokens, fetch: fetchMock });
  return { client, urls };
}

function page(results: unknown[], next: string | null, extra: Record<string, unknown> = {}) {
  return { count: 5, next, previous: null, results, ...extra };
}

describe("fetchAllPages", () => {
  it("follows next across three pages and returns every row in order", async () => {
    const { client, urls } = serve({
      "https://photos.example.com/api/persons/?page_size=2": page(
        [1, 2],
        "http://backend:8001/api/persons/?page=2&page_size=2"
      ),
      "https://photos.example.com/api/persons/?page=2&page_size=2": page(
        [3, 4],
        "http://backend:8001/api/persons/?page=3&page_size=2"
      ),
      "https://photos.example.com/api/persons/?page=3&page_size=2": page([5], null),
    });

    const rows = await fetchAllPages(client, "/persons/?page_size=2");

    expect(rows).toEqual([1, 2, 3, 4, 5]);
    // The next links name the backend's own host; only their query is used.
    expect(urls).toEqual([
      "https://photos.example.com/api/persons/?page_size=2",
      "https://photos.example.com/api/persons/?page=2&page_size=2",
      "https://photos.example.com/api/persons/?page=3&page_size=2",
    ]);
  });

  it("reads one page when next is null or missing", async () => {
    const { client, urls } = serve({
      "https://photos.example.com/api/tags/": { results: [{ id: 1 }] },
    });

    expect(await fetchAllPages(client, "/tags/")).toEqual([{ id: 1 }]);
    expect(urls).toHaveLength(1);
  });

  it("follows an older server's limit/offset next", async () => {
    const { client } = serve({
      "https://photos.example.com/api/user/": page(["a"], "https://photos.example.com/api/user/?limit=1&offset=1"),
      "https://photos.example.com/api/user/?limit=1&offset=1": page(["b"], null),
    });

    expect(await fetchAllPages(client, "/user/")).toEqual(["a", "b"]);
  });

  it("returns a bare array as it is", async () => {
    const { client } = serve({ "https://photos.example.com/api/albums/date/list/": [{ id: "1" }] });

    expect(await fetchAllPages(client, "/albums/date/list/")).toEqual([{ id: "1" }]);
  });

  it("rejects an answer that is neither a list nor a page", async () => {
    const { client } = serve({ "https://photos.example.com/api/tags/": { detail: "nope" } });

    await expect(fetchAllPages(client, "/tags/")).rejects.toBeInstanceOf(ResponseParseError);
  });

  it("stops on a next that points back at a page it already read", async () => {
    const { client } = serve({
      "https://photos.example.com/api/tags/?page=2": page([1], "https://photos.example.com/api/tags/?page=2"),
    });

    await expect(fetchAllPages(client, "/tags/?page=2")).rejects.toBeInstanceOf(ResponseParseError);
  });
});
