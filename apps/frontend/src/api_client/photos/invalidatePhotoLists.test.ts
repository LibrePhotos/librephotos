/**
 * Favouriting, hiding or trashing photos only refreshed the timeline queries,
 * so album, event, place, thing, tag, search and no-timestamp grids kept the
 * old stars and kept showing trashed photos until a reload.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidatePhotoLists } from "./invalidatePhotoLists";

describe("invalidatePhotoLists", () => {
  it("refreshes every query that feeds a photo grid", () => {
    const client = new QueryClient();
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");

    invalidatePhotoLists(client);

    const prefixes = invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(prefixes).toEqual(
      expect.arrayContaining([
        "dateAlbums",
        "dateAlbum",
        "recentlyAddedPhotos",
        "userAlbum",
        "autoAlbum",
        "placeAlbum",
        "thingsAlbum",
        "tagAlbum",
        "searchPhotos",
        "photosWithoutTimestamp",
      ])
    );
    // Prefix keys only, so every page / filter variant of a grid is refreshed.
    invalidateQueries.mock.calls.forEach(([filters]) => expect(filters?.queryKey).toHaveLength(1));
  });
});
