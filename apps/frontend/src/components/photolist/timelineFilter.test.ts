/**
 * The main timeline's filter (issue #2130): the URL overrides the saved
 * default key by key, the date-album requests and the select-all query carry
 * the resolved filter, and the query key changes with it.
 */
import { describe, expect, test } from "vitest";
import i18n from "../../i18n";
import {
  countActiveFilters,
  describeTimelineFilter,
  resolveTimelineFilter,
  sameTimelineFilter,
  SHOW_EVERYTHING,
  timelineFilterKey,
  timelineFilterShows,
  timelineFilterToBulkQuery,
  timelineFilterToParams,
  timelineSearchFor,
  validateTimelineSearch,
} from "./timelineFilter";

describe("resolveTimelineFilter", () => {
  test("no saved default and no URL params shows everything", () => {
    expect(resolveTimelineFilter({}, {})).toEqual(SHOW_EVERYTHING);
    expect(resolveTimelineFilter(undefined, {})).toEqual(SHOW_EVERYTHING);
  });

  test("a bare URL is the saved default", () => {
    expect(resolveTimelineFilter({ hide_screenshots: true, media: "photos" }, {})).toEqual({
      ...SHOW_EVERYTHING,
      media: "photos",
      hide_screenshots: true,
    });
  });

  test("URL params override the default key by key", () => {
    const saved = { hide_screenshots: true, hide_documents: true, media: "videos" as const };
    expect(resolveTimelineFilter(saved, { hide_screenshots: false, media: "all" })).toEqual({
      media: "all",
      hide_screenshots: false,
      hide_documents: true,
      favorites: false,
    });
  });
});

describe("validateTimelineSearch", () => {
  test("keeps known keys, parses booleans and drops the rest", () => {
    expect(
      validateTimelineSearch({
        media: "videos",
        hide_screenshots: true,
        hide_documents: "false",
        favorites: "yes",
        page: 3,
      })
    ).toEqual({ media: "videos", hide_screenshots: true, hide_documents: false });
  });

  test("rejects a media value the timeline does not offer", () => {
    expect(validateTimelineSearch({ media: "screenshots" })).toEqual({});
  });
});

describe("timelineSearchFor", () => {
  test("puts only the keys that differ from the default in the URL", () => {
    const saved = { hide_screenshots: true };
    expect(timelineSearchFor({ ...SHOW_EVERYTHING, hide_screenshots: true }, saved)).toEqual({});
    expect(timelineSearchFor({ ...SHOW_EVERYTHING, hide_screenshots: true, media: "photos" }, saved)).toEqual({
      media: "photos",
    });
    expect(timelineSearchFor(SHOW_EVERYTHING, saved)).toEqual({ hide_screenshots: false });
  });

  test("round-trips through resolveTimelineFilter", () => {
    const saved = { media: "photos" as const, favorites: true };
    const wanted = { media: "all" as const, hide_screenshots: true, hide_documents: false, favorites: false };
    expect(resolveTimelineFilter(saved, timelineSearchFor(wanted, saved))).toEqual(wanted);
  });
});

describe("request params, select-all query and query key", () => {
  const filter = { media: "photos" as const, hide_screenshots: true, hide_documents: true, favorites: true };

  test("the date-album requests send the resolved filter", () => {
    expect(timelineFilterToParams(filter)).toEqual({
      media: "photos",
      hide_screenshots: "true",
      hide_documents: "true",
      favorite: "true",
    });
    expect(timelineFilterToParams(SHOW_EVERYTHING)).toEqual({});
    expect(timelineFilterToParams(undefined)).toEqual({});
  });

  test("select-all carries the same filter, so it never reaches hidden screenshots", () => {
    expect(timelineFilterToBulkQuery(filter)).toEqual({
      media: "photos",
      hide_screenshots: true,
      hide_documents: true,
      favorite: true,
    });
    expect(timelineFilterToBulkQuery(SHOW_EVERYTHING)).toEqual({});
  });

  test("the query key changes with the filter and is stable for an equal one", () => {
    expect(timelineFilterKey(undefined)).toBe("none");
    expect(timelineFilterKey(SHOW_EVERYTHING)).toBe("none");
    expect(timelineFilterKey({ ...SHOW_EVERYTHING, hide_screenshots: true })).toBe("hide_screenshots=true");
    expect(timelineFilterKey({ ...filter })).toBe(timelineFilterKey(filter));
    expect(timelineFilterKey(filter)).not.toBe(timelineFilterKey({ ...filter, favorites: false }));
  });
});

describe("helpers", () => {
  test("countActiveFilters and sameTimelineFilter", () => {
    expect(countActiveFilters(SHOW_EVERYTHING)).toBe(0);
    expect(countActiveFilters({ ...SHOW_EVERYTHING, media: "videos", hide_documents: true })).toBe(2);
    expect(sameTimelineFilter(SHOW_EVERYTHING, { ...SHOW_EVERYTHING })).toBe(true);
    expect(sameTimelineFilter(SHOW_EVERYTHING, { ...SHOW_EVERYTHING, favorites: true })).toBe(false);
  });

  test("describeTimelineFilter", async () => {
    await i18n.changeLanguage("en");
    expect(describeTimelineFilter(SHOW_EVERYTHING, i18n.t)).toBe("Everything");
    expect(describeTimelineFilter({ ...SHOW_EVERYTHING, media: "photos", hide_screenshots: true }, i18n.t)).toBe(
      "Photos, no screenshots"
    );
  });

  test("timelineFilterShows mirrors the backend filter", () => {
    const screenshot = { video: false, is_screenshot: true, is_document: false, rating: 0 };
    expect(timelineFilterShows(SHOW_EVERYTHING, screenshot, 4)).toBe(true);
    expect(timelineFilterShows({ ...SHOW_EVERYTHING, hide_screenshots: true }, screenshot, 4)).toBe(false);
    expect(timelineFilterShows({ ...SHOW_EVERYTHING, favorites: true }, { ...screenshot, rating: 4 }, 4)).toBe(true);
    expect(timelineFilterShows({ ...SHOW_EVERYTHING, media: "videos" }, screenshot, 4)).toBe(false);
  });
});
