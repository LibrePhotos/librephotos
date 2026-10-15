/**
 * #2276: the info panel printed `ISO200`, `ƒ / 2.8` and `58.14 kB` with an English
 * decimal point in a German UI. #2275: a long exposure printed as a bare `2.5`.
 */
import { describe, expect, it } from "vitest";
import {
  coordinatesForClipboard,
  formatAltitude,
  formatAperture,
  formatCoordinates,
  formatDigitalZoom,
  formatDimensions,
  formatDuration,
  formatExposureBias,
  formatFocalLength,
  formatIso,
  formatMegapixels,
  formatShutterSpeed,
  formatSubjectDistance,
  formatVideoCodec,
} from "./exifFormat";

type Row<I> = [input: I, en: string | null, de: string | null];

describe("formatAperture", () => {
  it.each<Row<number | null | undefined>>([
    [2.8, "ƒ/2.8", "ƒ/2,8"],
    [5.6, "ƒ/5.6", "ƒ/5,6"],
    [8, "ƒ/8", "ƒ/8"],
    [1.78, "ƒ/1.8", "ƒ/1,8"],
    [0, null, null],
    [null, null, null],
    [undefined, null, null],
  ])("%s", (fstop, en, de) => {
    expect(formatAperture(fstop, "en")).toBe(en);
    expect(formatAperture(fstop, "de")).toBe(de);
  });
});

describe("formatShutterSpeed", () => {
  it.each<Row<string | null | undefined>>([
    // A fraction of a second stays as cameras print it.
    ["1/4000", "1/4000", "1/4000"],
    ["1/250", "1/250", "1/250"],
    // Seconds get a unit, so 30 does not read as 1/30.
    ["2.5", "2.5 s", "2,5 s"],
    ["0.3", "0.3 s", "0,3 s"],
    ["30", "30 s", "30 s"],
    // An older backend's improper fraction becomes a proper value.
    ["5/2", "2.5 s", "2,5 s"],
    ["10/1000", "1/100", "1/100"],
    // A short exposure stored in seconds is a fraction again.
    ["0.004", "1/250", "1/250"],
    // Nothing to say: missing, or an older backend's 0.
    ["0", null, null],
    ["0/1", null, null],
    ["", null, null],
    [null, null, null],
    [undefined, null, null],
    // Something this app does not know is shown as stored.
    ["bulb", "bulb", "bulb"],
  ])("%s", (value, en, de) => {
    expect(formatShutterSpeed(value, "en")).toBe(en);
    expect(formatShutterSpeed(value, "de")).toBe(de);
  });
});

describe("formatIso", () => {
  it.each<[number | null | undefined, string | null]>([
    [200, "ISO 200"],
    [12800, "ISO 12800"],
    [0, null],
    [null, null],
  ])("%s", (iso, expected) => {
    expect(formatIso(iso)).toBe(expected);
  });
});

describe("formatFocalLength", () => {
  it.each<Row<number | null | undefined>>([
    [23, "23 mm", "23 mm"],
    [23.4, "23.4 mm", "23,4 mm"],
    [6.765, "6.8 mm", "6,8 mm"],
    [0, null, null],
    [null, null, null],
  ])("%s", (mm, en, de) => {
    expect(formatFocalLength(mm, "en")).toBe(en);
    expect(formatFocalLength(mm, "de")).toBe(de);
  });
});

describe("formatExposureBias", () => {
  it.each<Row<number | null | undefined>>([
    [0.7, "+0.7 EV", "+0,7 EV"],
    [-1.3, "-1.3 EV", "-1,3 EV"],
    [0.333, "+0.3 EV", "+0,3 EV"],
    [2, "+2 EV", "+2 EV"],
    // No bias says nothing.
    [0, null, null],
    [0.01, null, null],
    [null, null, null],
  ])("%s", (ev, en, de) => {
    expect(formatExposureBias(ev, "en")).toBe(en);
    expect(formatExposureBias(ev, "de")).toBe(de);
  });
});

describe("formatSubjectDistance and formatDigitalZoom", () => {
  it.each<Row<number | null>>([
    [12.4, "12.4 m", "12,4 m"],
    [0.35, "0.35 m", "0,35 m"],
    [125.6, "126 m", "126 m"],
    [0, null, null],
    [null, null, null],
  ])("distance %s", (metres, en, de) => {
    expect(formatSubjectDistance(metres, "en")).toBe(en);
    expect(formatSubjectDistance(metres, "de")).toBe(de);
  });

  it.each<Row<number | null>>([
    [1.5, "1.5×", "1,5×"],
    [2, "2×", "2×"],
    [1, null, null],
    [0, null, null],
    [null, null, null],
  ])("zoom %s", (ratio, en, de) => {
    expect(formatDigitalZoom(ratio, "en")).toBe(en);
    expect(formatDigitalZoom(ratio, "de")).toBe(de);
  });
});

describe("formatDimensions and formatMegapixels", () => {
  it("prints width first, without digit grouping", () => {
    expect(formatDimensions(6240, 4160)).toBe("6240 × 4160");
    expect(formatDimensions(0, 4160)).toBeNull();
    expect(formatDimensions(null, null)).toBeNull();
  });

  it.each<[number | null, number | null, string | null, string | null]>([
    [6240, 4160, "26 MP", "26 MP"],
    [4032, 3024, "12.2 MP", "12,2 MP"],
    [1600, 1200, "1.9 MP", "1,9 MP"],
    [100, 100, null, null],
    [0, 3000, null, null],
    [null, 3000, null, null],
  ])("%s × %s", (width, height, en, de) => {
    expect(formatMegapixels(width, height, "en")).toBe(en);
    expect(formatMegapixels(width, height, "de")).toBe(de);
  });
});

describe("formatCoordinates", () => {
  it("prints five decimals in the UI language", () => {
    expect(formatCoordinates(37.0899, -8.4128, "en")).toBe("37.08990, -8.41280");
    // A comma is the decimal separator: the two numbers are kept apart by a semicolon.
    expect(formatCoordinates(37.0899, -8.4128, "de")).toBe("37,08990; -8,41280");
  });

  it("keeps the equator and the prime meridian (#2283)", () => {
    expect(formatCoordinates(0, 0, "en")).toBe("0.00000, 0.00000");
  });

  it("has nothing without both coordinates", () => {
    expect(formatCoordinates(null, 8.4, "en")).toBeNull();
    expect(formatCoordinates(37.1, undefined, "en")).toBeNull();
  });

  it("copies them the way maps take them, in any language", () => {
    expect(coordinatesForClipboard(37.0899, -8.4128)).toBe("37.08990, -8.41280");
  });

  it("falls back to English for a language tag Intl does not know", () => {
    expect(formatCoordinates(1.5, 2.5, "not a tag!")).toBe("1.50000, 2.50000");
  });
});

describe("formatAltitude", () => {
  it.each<[number | null | undefined, string, { distance: string; belowSeaLevel: boolean } | null]>([
    [31.4, "en", { distance: "31 m", belowSeaLevel: false }],
    [1234.5, "de", { distance: "1.235 m", belowSeaLevel: false }],
    [-4, "en", { distance: "4 m", belowSeaLevel: true }],
    // Sea level is a height too.
    [0, "en", { distance: "0 m", belowSeaLevel: false }],
    [null, "en", null],
    [undefined, "en", null],
  ])("%s (%s)", (metres, locale, expected) => {
    expect(formatAltitude(metres, locale)).toEqual(expected);
  });
});

describe("formatDuration", () => {
  it.each<[string | number | null | undefined, string | null]>([
    ["42.042", "0:42"],
    ["62", "1:02"],
    [3723, "1:02:03"],
    ["0", null],
    ["None", null],
    ["", null],
    [null, null],
  ])("%s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatVideoCodec", () => {
  it.each<[string | null | undefined, string | null]>([
    ["h264", "H.264"],
    ["hevc", "HEVC"],
    ["AV1", "AV1"],
    ["prores", "ProRes"],
    ["theora", "THEORA"],
    ["", null],
    [null, null],
  ])("%s", (codec, expected) => {
    expect(formatVideoCodec(codec)).toBe(expected);
  });
});
