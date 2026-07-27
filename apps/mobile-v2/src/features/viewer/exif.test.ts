import {
  captureSummary,
  directoryFromPaths,
  filenameFromPaths,
  formatAperture,
  formatDigitalZoom,
  formatDimensions,
  formatFocalLength,
  formatIso,
  formatMegapixels,
  formatShutterSpeed,
  formatSubjectDistance,
  probabilityColor,
  sceneLabels,
  suggestedCaption,
  userCaption,
} from "./exif";

describe("exif formatting", () => {
  it("formats the capture settings the sidebar shows", () => {
    expect(formatAperture(2.8)).toBe("ƒ / 2.8");
    expect(formatShutterSpeed("1/250")).toBe("1/250");
    expect(formatIso(400)).toBe("ISO400");
    expect(formatFocalLength(34.6)).toBe("35 mm");
    expect(formatSubjectDistance(1.4)).toBe("1.4 m");
  });

  /**
   * The web's `FileInfoComponent` filters values by string-matching the already
   * interpolated text for "undefined" / "null" / "0 mm", which both keeps a zero
   * aperture and drops legitimate values. Absence is decided before formatting
   * here, so each of these is dropped for the right reason.
   */
  it("drops values that are absent rather than rendering placeholder text", () => {
    for (const absent of [null, undefined, 0]) {
      expect(formatAperture(absent)).toBeNull();
      expect(formatIso(absent)).toBeNull();
      expect(formatFocalLength(absent)).toBeNull();
      expect(formatSubjectDistance(absent)).toBeNull();
    }
    expect(formatShutterSpeed("")).toBeNull();
    expect(formatShutterSpeed("  ")).toBeNull();
    expect(formatShutterSpeed("null")).toBeNull();
  });

  it("treats a digital zoom of exactly 1 as no zoom at all", () => {
    expect(formatDigitalZoom(1)).toBeNull();
    expect(formatDigitalZoom(2.5)).toBe("2.5×");
  });

  it("describes photos width-first, with megapixels", () => {
    expect(formatDimensions(4032, 3024)).toBe("4032 × 3024");
    expect(formatMegapixels(4032, 3024)).toBe("12.2 MP");
    expect(formatDimensions(null, 3024)).toBeNull();
    // A thumbnail-sized image rounds below the reporting threshold.
    expect(formatMegapixels(10, 10)).toBeNull();
  });

  it("joins the exposure line and drops the gaps", () => {
    expect(
      captureSummary({ fstop: 1.8, shutter_speed: "1/60", iso: 100, focal_length: 24 })
    ).toBe("ƒ / 1.8 · 1/60 · 24 mm · ISO100");
    expect(captureSummary({ fstop: null, shutter_speed: null, iso: 200, focal_length: null })).toBe(
      "ISO200"
    );
    expect(captureSummary({})).toBeNull();
  });

  it("reads filenames out of either separator (LibrePhotos stores raw paths)", () => {
    expect(filenameFromPaths(["/data/photos/2024/IMG_0001.JPG"])).toBe("IMG_0001.JPG");
    expect(filenameFromPaths(["C:\\Users\\me\\Pictures\\IMG_2.jpg"])).toBe("IMG_2.jpg");
    expect(directoryFromPaths(["/data/photos/2024/IMG_0001.JPG"])).toBe("/data/photos/2024");
    expect(filenameFromPaths([])).toBeNull();
    expect(filenameFromPaths(undefined)).toBeNull();
  });

  it("pulls captions and scene labels out of the captions blob", () => {
    const blob = {
      user_caption: "Beach day",
      im2txt: "a person standing on a beach",
      places365: { attributes: ["sunny"], categories: ["beach"] },
      siglip2: { tags: ["ocean"] },
    };
    expect(userCaption(blob)).toBe("Beach day");
    expect(suggestedCaption(blob)).toBe("a person standing on a beach");
    expect(sceneLabels(blob)).toEqual({
      attributes: ["sunny"],
      categories: ["beach"],
      tags: ["ocean"],
    });
  });

  it("survives a missing or malformed captions blob", () => {
    for (const blob of [null, undefined, "not json", 42, {}]) {
      expect(userCaption(blob)).toBeNull();
      expect(suggestedCaption(blob)).toBeNull();
      expect(sceneLabels(blob)).toEqual({ attributes: [], categories: [], tags: [] });
    }
    // A whitespace-only caption is "no caption", not an empty paragraph.
    expect(userCaption({ user_caption: "   " })).toBeNull();
  });

  it("colours face confidence on the same thresholds as the web dashboard", () => {
    expect(probabilityColor(0.95)).toBe(probabilityColor(1));
    expect(probabilityColor(0.95)).not.toBe(probabilityColor(0.5));
    expect(probabilityColor(null)).toBe("#9aa0a6");
  });
});
