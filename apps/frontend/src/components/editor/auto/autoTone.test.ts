import { describe, expect, it } from "vitest";
import { readNumber } from "../engine/controls";
import { DEFAULT_RECIPE } from "../engine/recipe";
import { autoTone, withAutoTone, type AutoTone } from "./autoTone";

/** A luminance histogram of 100 000 pixels whose density over the display value (0 to 1) is `density`. */
function synthetic(density: (value: number) => number): Uint32Array {
  const weights = Array.from({ length: 256 }, (_, i) => Math.max(0, density(i / 255)));
  const sum = weights.reduce((a, b) => a + b, 0);
  return Uint32Array.from(weights, weight => Math.round((weight / sum) * 100000));
}

const bell = (centre: number, width: number) => (v: number) => Math.exp(-(((v - centre) / width) ** 2) / 2);
const between = (lo: number, hi: number) => (v: number) => (v >= lo && v <= hi ? 1 : 0);

function expectBounded(tone: AutoTone) {
  expect(Math.abs(tone.exposure)).toBeLessThanOrEqual(2);
  for (const key of ["contrast", "highlights", "shadows", "whites", "blacks"] as const) {
    expect(Math.abs(tone[key])).toBeLessThanOrEqual(60);
    expect(Number.isInteger(tone[key])).toBe(true);
  }
}

describe("autoTone", () => {
  it("leaves a balanced photo nearly alone", () => {
    const tone = autoTone(synthetic(bell(0.47, 0.2)));
    expectBounded(tone);
    expect(Math.abs(tone.exposure)).toBeLessThanOrEqual(0.25);
    for (const key of ["contrast", "highlights", "shadows", "whites", "blacks"] as const) {
      expect(Math.abs(tone[key])).toBeLessThanOrEqual(10);
    }
  });

  it("brightens a dark photo without blowing its highlights", () => {
    const tone = autoTone(synthetic(bell(0.15, 0.07)));
    expectBounded(tone);
    expect(tone.exposure).toBeGreaterThan(0.5);
  });

  it("darkens a bright photo", () => {
    const tone = autoTone(synthetic(bell(0.8, 0.08)));
    expectBounded(tone);
    expect(tone.exposure).toBeLessThan(-0.3);
  });

  it("spreads a flat, foggy photo", () => {
    const tone = autoTone(synthetic(between(0.35, 0.62)));
    expectBounded(tone);
    expect(tone.contrast).toBeGreaterThan(10);
    expect(tone.whites).toBeGreaterThan(0);
    expect(tone.blacks).toBeLessThan(0);
  });

  it("recovers a contrasty photo with clipped ends", () => {
    const tone = autoTone(synthetic(v => (v < 0.06 || v > 0.94 ? 6 : 0.4)));
    expectBounded(tone);
    expect(tone.highlights).toBeLessThan(0);
    expect(tone.shadows).toBeGreaterThan(0);
    expect(tone.contrast).toBeLessThanOrEqual(0);
  });

  it("is deterministic and answers zeros for an empty histogram", () => {
    const histogram = synthetic(bell(0.3, 0.1));
    expect(autoTone(histogram)).toEqual(autoTone(histogram));
    expect(autoTone(new Uint32Array(256))).toEqual({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
    });
  });

  it("sets the six light controls of a recipe and nothing else", () => {
    const base = { ...DEFAULT_RECIPE, color: { ...DEFAULT_RECIPE.color, saturation: 12 } };
    const recipe = withAutoTone(base, {
      exposure: 0.4,
      contrast: 10,
      highlights: -20,
      shadows: 15,
      whites: 5,
      blacks: -8,
    });
    expect(recipe.light).toEqual({ exposure: 0.4, contrast: 10, highlights: -20, shadows: 15, whites: 5, blacks: -8 });
    expect(readNumber(recipe, "color.saturation")).toBe(12);
  });
});
