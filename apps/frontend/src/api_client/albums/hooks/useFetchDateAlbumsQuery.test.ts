import { describe, expect, test } from "vitest";
import { addTempElementsToGroups } from "../../../util/util";
import { IncompleteDatePhotosGroup, Photoset, PigPhoto } from "../../photos/types";
import {
  buildDateAlbumFilterParams,
  DATE_ALBUM_PAGE_SIZE,
  hydrateGroupsFromCachedPages,
} from "./useFetchDateAlbumsQuery";

/**
 * `buildDateAlbumFilterParams` is the shared param-builder for the date-album
 * list and detail queries. It maps the active Photoset plus the independent
 * per-view media-type toggle onto the backend's boolean query params.
 *
 * Regression guard: the media-type toggle (used on e.g. person album pages)
 * must drive `is_screenshot` the same way it drives `photo`/`video`. A previous
 * revision handled screenshots only via `photosetType`, so the Screenshots
 * toggle no-opped on those surfaces.
 */
describe("buildDateAlbumFilterParams — photosetType", () => {
  test("VIDEOS sets only video", () => {
    expect(buildDateAlbumFilterParams(Photoset.VIDEOS)).toEqual({
      favorite: undefined,
      public: undefined,
      hidden: undefined,
      in_trashcan: undefined,
      photo: undefined,
      video: "true",
      is_screenshot: undefined,
    });
  });

  test("SCREENSHOTS sets only is_screenshot", () => {
    expect(buildDateAlbumFilterParams(Photoset.SCREENSHOTS)).toEqual({
      favorite: undefined,
      public: undefined,
      hidden: undefined,
      in_trashcan: undefined,
      photo: undefined,
      video: undefined,
      is_screenshot: "true",
    });
  });

  test("FAVORITES sets only favorite, leaving media flags untouched", () => {
    const params = buildDateAlbumFilterParams(Photoset.FAVORITES);
    expect(params.favorite).toBe("true");
    expect(params.photo).toBeUndefined();
    expect(params.video).toBeUndefined();
    expect(params.is_screenshot).toBeUndefined();
  });
});

describe("buildDateAlbumFilterParams — mediaType toggle layered on a neutral surface", () => {
  test("mediaType 'photos' sets photo", () => {
    const params = buildDateAlbumFilterParams(Photoset.PERSON, "photos");
    expect(params.photo).toBe("true");
    expect(params.video).toBeUndefined();
    expect(params.is_screenshot).toBeUndefined();
  });

  test("mediaType 'videos' sets video", () => {
    const params = buildDateAlbumFilterParams(Photoset.PERSON, "videos");
    expect(params.video).toBe("true");
    expect(params.photo).toBeUndefined();
    expect(params.is_screenshot).toBeUndefined();
  });

  test("mediaType 'screenshots' sets is_screenshot (the fixed regression)", () => {
    const params = buildDateAlbumFilterParams(Photoset.PERSON, "screenshots");
    expect(params.is_screenshot).toBe("true");
    expect(params.photo).toBeUndefined();
    expect(params.video).toBeUndefined();
  });

  test("mediaType 'all' / undefined sets no media flag", () => {
    expect(buildDateAlbumFilterParams(Photoset.PERSON, "all").is_screenshot).toBeUndefined();
    expect(buildDateAlbumFilterParams(Photoset.PERSON).is_screenshot).toBeUndefined();
    expect(buildDateAlbumFilterParams(Photoset.PERSON, "all").photo).toBeUndefined();
    expect(buildDateAlbumFilterParams(Photoset.PERSON, "all").video).toBeUndefined();
  });
});

/**
 * `hydrateGroupsFromCachedPages` re-applies the day pages the per-day query
 * already loaded when the date-album list is refetched. Without it, every
 * invalidation of the list (e.g. after an upload finished) replaced the
 * loaded days with temp placeholders that nothing re-requested, leaving the
 * timeline as bare date headers.
 */
function tempGroup(id: string, numberOfItems: number): IncompleteDatePhotosGroup {
  const group = { id, date: id, location: "", incomplete: true, numberOfItems, items: [] } as IncompleteDatePhotosGroup;
  addTempElementsToGroups([group]);
  return group;
}

const photo = (id: string) => ({ id, aspectRatio: 1.5, isTemp: false }) as PigPhoto;

describe("hydrateGroupsFromCachedPages", () => {
  test("replaces placeholders of a loaded page and keeps the rest temp", () => {
    const groups = [tempGroup("2026-08-05", 3), tempGroup("2026-06-17", 2)];

    hydrateGroupsFromCachedPages(groups, [{ albumDateId: "2026-08-05", page: 1, items: [photo("a"), photo("b")] }]);

    expect(groups[0].items.map(i => i.id)).toEqual(["a", "b", "2"]);
    expect(groups[0].items[2].isTemp).toBe(true);
    expect(groups[1].items.every(i => i.isTemp)).toBe(true);
  });

  test("places later pages at their page offset", () => {
    const groups = [tempGroup("d", DATE_ALBUM_PAGE_SIZE + 1)];

    hydrateGroupsFromCachedPages(groups, [{ albumDateId: "d", page: 2, items: [photo("last")] }]);

    expect(groups[0].items[DATE_ALBUM_PAGE_SIZE].id).toBe("last");
    expect(groups[0].items.slice(0, DATE_ALBUM_PAGE_SIZE).every(i => i.isTemp)).toBe(true);
  });

  test("does not grow a group past the server-reported count", () => {
    const groups = [tempGroup("d", 1)];

    hydrateGroupsFromCachedPages(groups, [{ albumDateId: "d", page: 1, items: [photo("a"), photo("deleted")] }]);

    expect(groups[0].items.map(i => i.id)).toEqual(["a"]);
  });

  test("ignores pages of days that are no longer in the list", () => {
    const groups = [tempGroup("d", 1)];

    hydrateGroupsFromCachedPages(groups, [{ albumDateId: "gone", page: 1, items: [photo("x")] }]);

    expect(groups[0].items[0].isTemp).toBe(true);
  });
});
