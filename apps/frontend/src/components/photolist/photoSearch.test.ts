/**
 * The open lightbox photo is a photo list's `?photo=` search param (#2231). Every list route
 * keeps it next to its own params, and the history entry the lightbox pushes shares the grid
 * entry's scroll position, so Back from the lightbox leaves the grid where the lightbox left it.
 */
import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { validateMediaSearch } from "./mediaTypeFilter";
import { photoListScrollRestorationKey, validatePhotoSearch, withPhotoSearch } from "./photoSearch";
import { validateTimelineSearch } from "./timelineFilter";

const ID = "3f2a9c0e1b7d4e8f9a6b5c4d3e2f1a0b";

describe("validatePhotoSearch", () => {
  it("keeps a photo id", () => {
    expect(validatePhotoSearch({ photo: ID })).toEqual({ photo: ID });
  });

  it("drops anything that is not an id, and every other param", () => {
    expect(validatePhotoSearch({})).toEqual({});
    expect(validatePhotoSearch({ photo: "" })).toEqual({});
    expect(validatePhotoSearch({ photo: 12 })).toEqual({});
    expect(validatePhotoSearch({ photo: [ID] })).toEqual({});
    expect(validatePhotoSearch({ media: "videos" })).toEqual({});
  });

  it("reads an id the router's JSON parsing could mistake for a number, as the router writes it", () => {
    // The router quotes a string that would parse as JSON, so it comes back a string.
    expect(validatePhotoSearch(defaultParseSearch("?photo=%2212e45%22"))).toEqual({ photo: "12e45" });
  });
});

describe("the list routes' search", () => {
  it("adds the photo to the timeline's filter keys", () => {
    const validate = withPhotoSearch(validateTimelineSearch);
    expect(validate({ media: "videos", favorites: true, photo: ID, other: 1 })).toEqual({
      media: "videos",
      favorites: true,
      photo: ID,
    });
    expect(validate({ photo: 5 })).toEqual({});
  });

  it("keeps the photo next to the media filter", () => {
    expect(validateMediaSearch({ media: "photos", photo: ID })).toEqual({ media: "photos", photo: ID });
    expect(validateMediaSearch({ media: "all", photo: ID })).toEqual({ photo: ID });
  });
});

describe("photoListScrollRestorationKey", () => {
  const location = (state: Record<string, string | undefined>) => ({
    href: "/favorites",
    state: { __TSR_index: 1, ...state },
  });

  it("gives the lightbox's entry the key of the grid entry it was opened from", () => {
    expect(photoListScrollRestorationKey(location({ __TSR_key: "lightbox", lightboxFrom: "grid" }))).toBe("grid");
  });

  it("keeps the router's own key for every other entry, and the address before there is one", () => {
    expect(photoListScrollRestorationKey(location({ __TSR_key: "grid" }))).toBe("grid");
    expect(photoListScrollRestorationKey(location({}))).toBe("/favorites");
  });
});
