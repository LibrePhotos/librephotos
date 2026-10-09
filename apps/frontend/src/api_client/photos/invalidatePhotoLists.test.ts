/**
 * Favouriting, hiding or trashing photos only refreshed the timeline queries,
 * so album, event, place, thing, tag, search and no-timestamp grids kept the
 * old stars and kept showing trashed photos until a reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidatePhotoLists } from "./invalidatePhotoLists";

const stubs = vi.hoisted(() => ({
  invalidateQueries: vi.fn<(filters: { queryKey: readonly unknown[] }) => void>(),
}));

vi.mock("../api", () => ({ queryClient: { invalidateQueries: stubs.invalidateQueries } }));

afterEach(() => stubs.invalidateQueries.mockReset());

describe("invalidatePhotoLists", () => {
  it("refreshes every query that feeds a photo grid", () => {
    invalidatePhotoLists();

    const prefixes = stubs.invalidateQueries.mock.calls.map(([filters]) => filters.queryKey[0]);
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
    stubs.invalidateQueries.mock.calls.forEach(([filters]) => expect(filters.queryKey).toHaveLength(1));
  });
});
