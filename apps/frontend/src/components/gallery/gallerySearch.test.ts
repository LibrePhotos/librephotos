import { describe, expect, it } from "vitest";
import { galleryFilter, validateGallerySearch } from "./gallerySearch";

describe("the public gallery's address", () => {
  it("keeps a tab, a photographer, a town, a person and the open photo", () => {
    expect(validateGallerySearch({ tab: "places", owner: "2", place: "Munich", person: 7, photo: "abc" })).toEqual({
      tab: "places",
      owner: 2,
      place: "Munich",
      person: 7,
      photo: "abc",
    });
  });

  it("drops what it does not know, and the timeline tab it shows anyway", () => {
    expect(
      validateGallerySearch({ tab: "timeline", owner: "-1", place: "  ", person: "x", photo: 3, extra: 1 })
    ).toEqual({});
    expect(validateGallerySearch({ tab: "admin", owner: 1.5 })).toEqual({});
  });

  it("gives the filters without the ones that are not set", () => {
    expect(galleryFilter({ tab: "people", owner: 2, photo: "abc" })).toEqual({ owner: 2 });
    expect(galleryFilter({ place: "Munich", person: 3 })).toEqual({ place: "Munich", person: 3 });
  });
});
