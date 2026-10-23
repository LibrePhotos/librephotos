import { slideSource, type OriginalDetails } from "./originalSource";

const remote = { type: "image", image_hash: "hashA", local_uri: null };
const jpeg: OriginalDetails = {
  image_path: ["/photos/IMG_1.JPG"],
  original_mime_type: "image/jpeg",
  local_orientation: 1,
};

describe("slideSource", () => {
  it("loads the original of a JPEG once the user zoomed in", () => {
    expect(slideSource(remote, true, true, jpeg)).toEqual({ kind: "original", zoom: true });
  });

  it("keeps the thumbnail until the first zoom", () => {
    expect(slideSource(remote, true, false, jpeg)).toEqual({ kind: "thumbnail" });
  });

  it("loads the original of a HEIC, which phones draw", () => {
    expect(slideSource(remote, true, true, { ...jpeg, original_mime_type: "image/heic" })).toEqual({
      kind: "original",
      zoom: true,
    });
  });

  it("keeps the preview of a RAW, TIFF or JPEG XL original, and says why", () => {
    const source = (mime: string) => slideSource(remote, true, true, { ...jpeg, original_mime_type: mime });
    expect(source("image/x-dcraw")).toEqual({ kind: "preview", reason: "raw" });
    expect(source("image/tiff")).toEqual({ kind: "preview", reason: "tiff" });
    expect(source("image/jxl")).toEqual({ kind: "preview", reason: "jxl" });
    expect(source("image/bmp")).toEqual({ kind: "preview", reason: "other" });
  });

  it("keeps the preview of a photo turned in LibrePhotos, which the file does not show", () => {
    expect(slideSource(remote, true, true, { ...jpeg, local_orientation: 6 })).toEqual({
      kind: "preview",
      reason: "rotated",
    });
  });

  it("leaves camera-roll slides and inactive slides alone", () => {
    expect(slideSource({ ...remote, local_uri: "ph://L1" }, true, true, jpeg)).toEqual({ kind: "thumbnail" });
    expect(slideSource({ ...remote, image_hash: null }, true, true, jpeg)).toEqual({ kind: "thumbnail" });
    expect(slideSource(remote, false, true, jpeg)).toEqual({ kind: "thumbnail" });
  });

  it("keeps the thumbnail while the details are not in, or from a server that does not say", () => {
    expect(slideSource(remote, true, true, null)).toEqual({ kind: "thumbnail" });
    expect(slideSource(remote, true, true, { image_path: ["/photos/a.jpg"] })).toEqual({ kind: "thumbnail" });
  });

  it("shows an animated original from the start, by type or (older servers) by file name", () => {
    expect(slideSource(remote, true, false, { ...jpeg, original_mime_type: "image/gif" })).toEqual({
      kind: "original",
      zoom: false,
    });
    expect(slideSource(remote, true, false, { image_path: ["/photos/a.GIF"] })).toEqual({
      kind: "original",
      zoom: false,
    });
    // Not on a slide that is not active.
    expect(slideSource(remote, false, false, { image_path: ["/photos/a.gif"] })).toEqual({ kind: "thumbnail" });
  });

  it("shows a motion photo's original on every slide, as before", () => {
    expect(slideSource({ ...remote, type: "motion_photo" }, false, false, null)).toEqual({
      kind: "original",
      zoom: false,
    });
  });
});
