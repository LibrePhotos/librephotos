import { describe, expect, it } from "vitest";
import type { Histogram } from "../engine/histogram";
import { clippingOf, histogramPath, pixelCount, sharedScale } from "./histogramModel";

function histogramOf(counts: Partial<Record<number, number>>): Histogram {
  const bins = new Uint32Array(256);
  for (const [bin, count] of Object.entries(counts)) bins[Number(bin)] = count ?? 0;
  return { r: bins, g: bins.slice(), b: bins.slice(), luma: bins.slice() };
}

describe("histogramModel", () => {
  it("draws a closed outline scaled to the tallest bin between the ends", () => {
    const bins = new Uint32Array(256);
    bins[0] = 1000;
    bins[128] = 10;
    bins[64] = 5;
    const path = histogramPath(bins, 255, 100);
    expect(path.startsWith("M0 100 ")).toBe(true);
    expect(path.endsWith("L255 100 Z")).toBe(true);
    // The clipped end goes to the top, the peak between the ends reaches it, half the peak half way.
    expect(path).toContain("L0.00 0.00");
    expect(path).toContain("L128.00 0.00");
    expect(path).toContain("L64.00 50.00");
  });

  it("scales several channels alike", () => {
    const histogram = histogramOf({ 10: 4, 20: 8 });
    histogram.r[30] = 16;
    expect(sharedScale(histogram, ["luma", "r"])).toBe(16);
    expect(pixelCount(histogram)).toBe(12);
  });

  it("marks clipping only past a visible share at either end", () => {
    expect(clippingOf(histogramOf({ 0: 1, 128: 9999 }))).toEqual({ shadows: false, highlights: false });
    expect(clippingOf(histogramOf({ 0: 100, 128: 900, 255: 50 }))).toEqual({ shadows: true, highlights: true });
    expect(clippingOf(histogramOf({}))).toEqual({ shadows: false, highlights: false });
  });
});
