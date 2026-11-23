import { EDIT_BANDS } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { bandColor, bandHue, swatchPixels } from "./bandColors";

describe("bandColors", () => {
  it("takes each band's hue from the pipeline's band table", () => {
    expect(EDIT_BANDS.map(bandHue)).toEqual([29, 55, 105, 142, 195, 262, 298, 330]);
  });

  it("colours each chip like its band", () => {
    const [rr, rg, rb] = bandColor("red");
    expect(rr).toBeGreaterThan(rg);
    expect(rr).toBeGreaterThan(rb);
    const [gr, gg, gb] = bandColor("green");
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    const [br, , bb] = bandColor("blue");
    expect(bb).toBeGreaterThan(br);
    const [yr, yg, yb] = bandColor("yellow");
    expect(Math.min(yr, yg)).toBeGreaterThan(yb);
    // Eight distinct colours.
    expect(new Set(EDIT_BANDS.map(band => bandColor(band).join(","))).size).toBe(8);
  });

  it("fills a swatch with one opaque colour", () => {
    expect(Array.from(swatchPixels([1, 2, 3], 2, 1))).toEqual([1, 2, 3, 255, 1, 2, 3, 255]);
  });
});
