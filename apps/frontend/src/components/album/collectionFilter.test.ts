import type { UserAlbumInfo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import {
  albumsInCollection,
  collectionCounts,
  effectiveCollectionFilter,
  NOT_IN_A_COLLECTION,
  validateCollectionSearch,
} from "./collectionFilter";

const album = (id: number, collection_ids: number[]): UserAlbumInfo => ({
  id,
  title: `Album ${id}`,
  cover_photo: null,
  photo_count: 1,
  owner: { id: 1, username: "alice", first_name: "", last_name: "" },
  shared_to: [],
  created_on: "2026-10-01T00:00:00Z",
  favorited: false,
  locked: false,
  collection_ids,
});

const albums = [album(1, [3]), album(2, [3, 5]), album(3, [])];

describe("My Albums collection filter", () => {
  it("reads a collection id or 'none' from the URL and drops anything else", () => {
    expect(validateCollectionSearch({ collection: 3 })).toEqual({ collection: 3 });
    expect(validateCollectionSearch({ collection: "5" })).toEqual({ collection: 5 });
    expect(validateCollectionSearch({ collection: NOT_IN_A_COLLECTION })).toEqual({ collection: "none" });
    for (const collection of ["travel", 0, -1, 1.5, undefined, null]) {
      expect(validateCollectionSearch({ collection })).toEqual({});
    }
  });

  it("keeps the albums of one collection, or those in none", () => {
    expect(albumsInCollection(albums, undefined).map(a => a.id)).toEqual([1, 2, 3]);
    expect(albumsInCollection(albums, 3).map(a => a.id)).toEqual([1, 2]);
    expect(albumsInCollection(albums, 5).map(a => a.id)).toEqual([2]);
    expect(albumsInCollection(albums, NOT_IN_A_COLLECTION).map(a => a.id)).toEqual([3]);
  });

  it("counts each collection's albums and those in none", () => {
    const counts = collectionCounts(albums);
    expect(Object.fromEntries(counts.byCollection)).toEqual({ 3: 2, 5: 1 });
    expect(counts.none).toBe(1);
  });

  it("shows every album when the chosen collection is gone", () => {
    const collections = [{ id: 3, name: "Travel" }];
    expect(effectiveCollectionFilter(3, collections)).toBe(3);
    expect(effectiveCollectionFilter(9, collections)).toBeUndefined();
    expect(effectiveCollectionFilter(NOT_IN_A_COLLECTION, collections)).toBe("none");
    expect(effectiveCollectionFilter(undefined, collections)).toBeUndefined();
  });
});
