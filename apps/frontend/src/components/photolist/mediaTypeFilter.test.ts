import { describe, expect, test } from "vitest";
import { mediaTypeToBulkQuery, mediaTypeToParams, validateMediaSearch } from "./mediaTypeFilter";

describe("mediaTypeToParams", () => {
  test("maps photos to ?photo=true", () => {
    expect(mediaTypeToParams("photos")).toEqual({ photo: "true" });
  });

  test("maps videos to ?video=true", () => {
    expect(mediaTypeToParams("videos")).toEqual({ video: "true" });
  });

  test("maps screenshots to ?is_screenshot=true", () => {
    expect(mediaTypeToParams("screenshots")).toEqual({ is_screenshot: "true" });
  });

  test("maps documents to ?is_document=true", () => {
    expect(mediaTypeToParams("documents")).toEqual({ is_document: "true" });
  });

  test("sends no params for all / undefined", () => {
    expect(mediaTypeToParams("all")).toEqual({});
    expect(mediaTypeToParams(undefined)).toEqual({});
  });
});

describe("mediaTypeToBulkQuery", () => {
  test("maps photos/videos/screenshots/documents to their boolean flags", () => {
    expect(mediaTypeToBulkQuery("photos")).toEqual({ photo: true });
    expect(mediaTypeToBulkQuery("videos")).toEqual({ video: true });
    expect(mediaTypeToBulkQuery("screenshots")).toEqual({ is_screenshot: true });
    expect(mediaTypeToBulkQuery("documents")).toEqual({ is_document: true });
  });

  test("sends no flags for all / undefined", () => {
    expect(mediaTypeToBulkQuery("all")).toEqual({});
    expect(mediaTypeToBulkQuery(undefined)).toEqual({});
  });
});

describe("validateMediaSearch", () => {
  test("keeps the non-default media values", () => {
    expect(validateMediaSearch({ media: "photos" })).toEqual({ media: "photos" });
    expect(validateMediaSearch({ media: "videos" })).toEqual({ media: "videos" });
    expect(validateMediaSearch({ media: "screenshots" })).toEqual({ media: "screenshots" });
    expect(validateMediaSearch({ media: "documents" })).toEqual({ media: "documents" });
  });

  test("drops unknown or default values", () => {
    expect(validateMediaSearch({ media: "all" })).toEqual({});
    expect(validateMediaSearch({ media: "bogus" })).toEqual({});
    expect(validateMediaSearch({ media: ["videos"] })).toEqual({});
    expect(validateMediaSearch({})).toEqual({});
  });
});
