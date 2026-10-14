/**
 * The search filters live in the URL under the API's parameter names (#2259, #329): the route's
 * validateSearch keeps the good values and drops a bad one without losing the others, a filter
 * written by the router reads back the same, and a filter-only search's select-all sends the same
 * keys with show_all_stack_photos.
 */
import type { SearchFilters } from "@librephotos/api-client";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  CLEARED_SEARCH_FILTERS,
  countSearchFilters,
  hasSearchFilters,
  SEARCH_FILTER_KEYS,
  searchSelectAllQuery,
  validateSearchFilters,
  validateSearchPage,
} from "./searchFilter";

const EVERY_FILTER: SearchFilters = {
  camera: "X-T5",
  make: "FUJIFILM",
  lens: "XF23mmF1.4 R",
  iso_min: 400,
  iso_max: 3200,
  aperture_min: 1.4,
  aperture_max: 2,
  focal_min: 23,
  focal_max: 56.5,
  focal35_min: 35,
  focal35_max: 85,
  rating_min: 4,
  taken_after: "2024-03-01",
  taken_before: "2024-05-31",
  has_location: false,
  file_type: "raw",
  extension: "cr3",
  person: [3, 7],
};

describe("validateSearchFilters", () => {
  it("keeps every valid filter and drops unknown keys", () => {
    expect(validateSearchFilters({ ...EVERY_FILTER, media: "videos", search: "beach" })).toEqual(EVERY_FILTER);
  });

  it("drops a bad value without losing the other filters", () => {
    const filters = validateSearchFilters({
      camera: "",
      iso_min: -5,
      iso_max: 1.5,
      focal35_min: "wide",
      rating_min: 6,
      taken_after: "2023-02-29",
      taken_before: "yesterday",
      has_location: "maybe",
      file_type: "gif",
      extension: "../etc",
      person: [0],
      lens: "XF23mmF1.4 R",
    });
    expect(filters).toEqual({ lens: "XF23mmF1.4 R" });
  });

  it("reads hand-typed values the way the router parses them", () => {
    // ?camera=100&person=3&extension=.CR3&has_location=true
    expect(validateSearchFilters(defaultParseSearch("?camera=100&person=3&extension=.CR3&has_location=true"))).toEqual({
      camera: "100",
      person: [3],
      extension: "cr3",
      has_location: true,
    });
    // A repeated key: ?person=3&person=7&person=3
    expect(validateSearchFilters(defaultParseSearch("?person=3&person=7&person=3")).person).toEqual([3, 7]);
  });

  it("caps the people at the server's limit", () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => index + 1);
    expect(validateSearchFilters({ person: tooMany }).person).toBeUndefined();
  });
});

describe("the URL round trip", () => {
  it("restores every filter the router wrote", () => {
    const url = defaultStringifySearch({ media: "photos", ...EVERY_FILTER });
    expect(validateSearchPage(defaultParseSearch(url))).toEqual({ media: "photos", ...EVERY_FILTER });
  });

  it("keeps a text value that looks like a number a string", () => {
    const url = defaultStringifySearch({ camera: "100", lens: "true" });
    expect(validateSearchFilters(defaultParseSearch(url))).toEqual({ camera: "100", lens: "true" });
  });

  it("leaves cleared filters out of the URL, keeping the words' page and the media type", () => {
    const url = defaultStringifySearch({ media: "videos", ...EVERY_FILTER, ...CLEARED_SEARCH_FILTERS });
    expect(url).toBe("?media=videos");
  });
});

describe("countSearchFilters", () => {
  it("counts a range or a day span once and each person once", () => {
    expect(countSearchFilters({})).toBe(0);
    expect(countSearchFilters({ iso_min: 400, iso_max: 800, taken_after: "2024-01-01" })).toBe(2);
    expect(countSearchFilters(EVERY_FILTER)).toBe(14);
    expect(hasSearchFilters({ person: [1] })).toBe(true);
    expect(hasSearchFilters({ camera: undefined })).toBe(false);
  });

  it("knows every filter key", () => {
    expect(SEARCH_FILTER_KEYS).toHaveLength(Object.keys(EVERY_FILTER).length);
  });
});

describe("searchSelectAllQuery", () => {
  it("sends a filter-only search's filters, media type and every stacked photo", () => {
    expect(searchSelectAllQuery("", { camera: "X-T5", person: [3, 7] }, "videos")).toEqual({
      camera: "X-T5",
      person: [3, 7],
      video: true,
      show_all_stack_photos: true,
    });
  });

  it("selects the listed photos themselves when the search has words", () => {
    // The server's select-all ignores the words: it would act on photos the page does not show.
    expect(searchSelectAllQuery("beach", { camera: "X-T5" }, "all")).toBeUndefined();
  });
});
