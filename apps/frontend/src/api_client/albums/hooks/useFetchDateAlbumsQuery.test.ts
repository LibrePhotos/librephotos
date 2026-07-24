import { describe, expect, test } from "vitest";
import { Photoset } from "../../photos/types";
import { buildDateAlbumFilterParams } from "./useFetchDateAlbumsQuery";

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
