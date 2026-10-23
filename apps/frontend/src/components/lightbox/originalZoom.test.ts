import { describe, expect, it } from "vitest";
import { isAnimatedOriginal, originalZoomPlan, type OriginalZoomInput } from "./originalZoom";

const base: OriginalZoomInput = {
  details: { original_mime_type: "image/jpeg", width: 6000, height: 4000, local_orientation: 1, video: false },
  isMainContent: true,
  isPublic: false,
  thumbnailSize: { width: 1620, height: 1080 },
  rotatedHere: false,
};

function plan(change: Partial<OriginalZoomInput> = {}, details: OriginalZoomInput["details"] = {}) {
  return originalZoomPlan({ ...base, ...change, details: { ...base.details, ...details } });
}

describe("originalZoomPlan", () => {
  it("loads a JPEG bigger than its thumbnail", () => {
    expect(plan()).toEqual({ kind: "load" });
    expect(plan({}, { original_mime_type: "image/avif" })).toEqual({ kind: "load" });
  });

  it("loads when either size is unknown", () => {
    expect(plan({ thumbnailSize: null })).toEqual({ kind: "load" });
    expect(plan({}, { width: 0, height: null })).toEqual({ kind: "load" });
  });

  it("compares the longer edges, so a portrait thumbnail of a landscape record still compares", () => {
    expect(plan({ thumbnailSize: { width: 720, height: 1080 } }, { width: 1080, height: 720 })).toEqual({
      kind: "original",
      size: { width: 1080, height: 720 },
    });
  });

  it("says nothing for a neighbouring slide, a public page, a video or missing details", () => {
    expect(plan({ isMainContent: false })).toEqual({ kind: "none" });
    expect(plan({ isPublic: true })).toEqual({ kind: "none" });
    expect(plan({}, { video: true })).toEqual({ kind: "none" });
    expect(plan({}, { original_mime_type: null })).toEqual({ kind: "none" });
    expect(originalZoomPlan({ ...base, details: null })).toEqual({ kind: "none" });
  });

  it("names why a format stays on the preview", () => {
    expect(plan({}, { original_mime_type: "image/x-dcraw" })).toEqual({ kind: "preview", reason: "raw" });
    expect(plan({}, { original_mime_type: "image/heic" })).toEqual({ kind: "preview", reason: "heic" });
    expect(plan({}, { original_mime_type: "image/heif" })).toEqual({ kind: "preview", reason: "heic" });
    expect(plan({}, { original_mime_type: "image/tiff" })).toEqual({ kind: "preview", reason: "tiff" });
    expect(plan({}, { original_mime_type: "image/jxl" })).toEqual({ kind: "preview", reason: "jxl" });
    expect(plan({}, { original_mime_type: "image/bmp" })).toEqual({ kind: "preview", reason: "other" });
  });

  it("stays on the preview of a photo turned in LibrePhotos, which the file does not show", () => {
    expect(plan({}, { local_orientation: 6 })).toEqual({ kind: "preview", reason: "rotated" });
    expect(plan({ rotatedHere: true })).toEqual({ kind: "preview", reason: "rotated" });
  });

  it("shows an animated original as it is", () => {
    expect(plan({}, { original_mime_type: "image/gif" })).toEqual({
      kind: "original",
      size: { width: 6000, height: 4000 },
    });
    expect(plan({}, { original_mime_type: "image/apng", width: null })).toEqual({ kind: "original", size: null });
  });
});

describe("isAnimatedOriginal", () => {
  it("is true for GIF and APNG only", () => {
    expect(isAnimatedOriginal({ original_mime_type: "image/gif" })).toBe(true);
    expect(isAnimatedOriginal({ original_mime_type: "image/apng" })).toBe(true);
    expect(isAnimatedOriginal({ original_mime_type: "image/png" })).toBe(false);
    expect(isAnimatedOriginal(null)).toBe(false);
  });
});
