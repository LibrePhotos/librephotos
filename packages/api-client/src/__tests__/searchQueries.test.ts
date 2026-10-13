import { describe, expect, it, vi } from "vitest";
import { metadataValuesQueryOptions, photoGridKeys, searchKeys, searchPhotosQueryOptions } from "../hooks";
import { createApiClient } from "../transport";

const client = createApiClient({
  baseUrl: "https://demo.example.com",
  tokens: { getAccessToken: () => null, getRefreshToken: () => null, setAccessToken: () => {}, clearTokens: () => {} },
  fetch: vi.fn(() => Promise.reject(new Error("no request is expected here"))),
});

describe("photo search query", () => {
  // The semantic flag picks how the answer is parsed (a flat list or date groups) but was left out of
  // the key, so a semantic and a plain search for the same term shared one cache entry.
  it("keys a semantic search apart from a plain one, under the search grids' prefix", () => {
    const plain = searchPhotosQueryOptions(client, "tram", false).queryKey;
    const semantic = searchPhotosQueryOptions(client, "tram", true).queryKey;
    expect(semantic).not.toEqual(plain);
    expect(plain.slice(0, 2)).toEqual(photoGridKeys.kind("search"));
  });

  it("does not search for an empty term", () => {
    expect(searchPhotosQueryOptions(client, "").enabled).toBe(false);
    expect(searchPhotosQueryOptions(client, "", false, { camera: undefined }).enabled).toBe(false);
  });

  it("searches by filters alone, keyed by them under the plain search", () => {
    const filtered = searchPhotosQueryOptions(client, "", false, { person: [1, 2] });
    const other = searchPhotosQueryOptions(client, "", false, { person: [1] });
    expect(filtered.enabled).toBe(true);
    expect(filtered.queryKey).not.toEqual(other.queryKey);
    expect(filtered.queryKey.slice(0, 5)).toEqual(photoGridKeys.search("", "all", "grouped"));
  });

  it("keys the suggestions of each filter apart, under the search keys", () => {
    const cameras = metadataValuesQueryOptions(client, "camera").queryKey;
    expect(cameras).not.toEqual(metadataValuesQueryOptions(client, "lens").queryKey);
    expect(cameras.slice(0, 1)).toEqual(searchKeys.all);
  });
});
