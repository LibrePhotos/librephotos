import { describe, expect, it, vi } from "vitest";
import { queryKeys, searchPhotosQueryOptions } from "../hooks";
import { createApiClient } from "../transport";

const client = createApiClient({
  baseUrl: "https://demo.example.com",
  tokens: { getAccessToken: () => null, getRefreshToken: () => null, setAccessToken: () => {}, clearTokens: () => {} },
  fetch: vi.fn(() => Promise.reject(new Error("no request is expected here"))),
});

describe("photo search query", () => {
  // The semantic flag picks how the answer is parsed (a flat list or date groups) but was left out of
  // the key, so a semantic and a plain search for the same term shared one cache entry.
  it("keys a semantic search apart from a plain one, under the search prefix", () => {
    const plain = searchPhotosQueryOptions(client, "tram", false).queryKey;
    const semantic = searchPhotosQueryOptions(client, "tram", true).queryKey;
    expect(semantic).not.toEqual(plain);
    expect(plain.slice(0, 2)).toEqual(queryKeys.searchPhotos("tram").slice(0, 2));
  });

  it("does not search for an empty term", () => {
    expect(searchPhotosQueryOptions(client, "").enabled).toBe(false);
  });
});
