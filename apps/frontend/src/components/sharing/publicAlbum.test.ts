/**
 * A public album whose owner keeps the dates private arrives as one group
 * without a date. Shown as a date view, that read "Without Timestamp" and
 * "1 day" although the photos have dates.
 */
import { describe, expect, it } from "vitest";
import { isUndatedShare, publicSlideshowLink, validatePublicAlbumSearch } from "./publicAlbum";

describe("isUndatedShare", () => {
  it("is true for the single undated group of a share without timestamps", () => {
    expect(isUndatedShare([{ date: null }])).toBe(true);
    expect(isUndatedShare([{ date: "" }])).toBe(true);
  });

  it("is false for an album that shares its dates", () => {
    expect(isUndatedShare([{ date: "2024-06-01" }])).toBe(false);
    expect(isUndatedShare([{ date: "2024-06-01" }, { date: null }])).toBe(false);
    expect(isUndatedShare([])).toBe(false);
  });
});

describe("validatePublicAlbumSearch (#1457)", () => {
  it("keeps the slideshow flag in each form a link can carry it", () => {
    for (const slideshow of [1, "1", true, "true"]) {
      expect(validatePublicAlbumSearch({ slideshow })).toEqual({ slideshow: 1 });
    }
  });

  it("drops a missing or other value, and every other param", () => {
    expect(validatePublicAlbumSearch({})).toEqual({});
    expect(validatePublicAlbumSearch({ slideshow: 0 })).toEqual({});
    expect(validatePublicAlbumSearch({ slideshow: "yes" })).toEqual({});
    expect(validatePublicAlbumSearch({ slideshow: 1, user: "admin" })).toEqual({ slideshow: 1 });
  });
});

describe("publicSlideshowLink", () => {
  it("is the album link with the slideshow flag", () => {
    expect(publicSlideshowLink("porto")).toMatch(/\/public\/s\/porto\?slideshow=1$/);
  });
});
