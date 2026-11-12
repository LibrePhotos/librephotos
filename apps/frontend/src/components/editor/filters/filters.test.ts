import type { EditHistoryStep } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { readNumber, withControl } from "../engine/controls";
import { changesGeometry, DEFAULT_RECIPE, toSparse } from "../engine/recipe";
import { appliedFilter, blendFilter, EDIT_FILTERS, FILTER_IDS, filterStrength, type FilterValues } from "./filters";

const AT = "2026-11-12T09:30:00Z";
const LOOK: FilterValues = { "light.contrast": 40, "color.saturation": -100 };
const base = withControl(withControl(DEFAULT_RECIPE, "light.contrast", 10), "geometry.straighten", 5);

describe("the built-in looks", () => {
  it("are about twelve, each with its own id, and none turns or crops the picture", () => {
    expect(EDIT_FILTERS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(EDIT_FILTERS.map(filter => filter.id)).size).toBe(EDIT_FILTERS.length);
    for (const filter of EDIT_FILTERS) {
      const applied = blendFilter(DEFAULT_RECIPE, filter.values, 1);
      expect(changesGeometry(applied)).toBe(false);
      // Every value is in its control's range (the recipe parses).
      expect(() => toSparse(applied)).not.toThrow();
      expect(Object.keys(filter.values).length).toBeGreaterThan(0);
    }
  });

  it("are listed in FILTER_IDS order", () => {
    expect(EDIT_FILTERS.map(filter => filter.id)).toEqual([...FILTER_IDS]);
  });
});

describe("blendFilter", () => {
  it("moves each control of the look from the photo's value to the look's by the strength", () => {
    const half = blendFilter(base, LOOK, 0.5);
    expect(readNumber(half, "light.contrast")).toBe(25);
    expect(readNumber(half, "color.saturation")).toBe(-50);
    expect(blendFilter(base, LOOK, 0)).toEqual(base);
    expect(readNumber(blendFilter(base, LOOK, 1), "light.contrast")).toBe(40);
  });

  it("keeps everything the look does not set, the geometry included", () => {
    const full = blendFilter(base, LOOK, 1);
    expect(full.geometry).toEqual(base.geometry);
    expect(full.light.exposure).toBe(base.light.exposure);
  });

  it("gives a colourless grading wheel the look's hue at once, blending only its amount", () => {
    const look: FilterValues = { "grading.shadows.hue": 200, "grading.shadows.sat": 60 };
    const half = blendFilter(DEFAULT_RECIPE, look, 0.5);
    expect(half.grading.shadows).toEqual({ hue: 200, sat: 30, lum: 0 });
    expect(filterStrength(DEFAULT_RECIPE, look, half)).toBeCloseTo(0.5, 6);
    const tinted = withControl(withControl(DEFAULT_RECIPE, "grading.shadows.sat", 20), "grading.shadows.hue", 100);
    expect(blendFilter(tinted, look, 0.5).grading.shadows.hue).toBe(150);
  });

  it("clamps the strength to 0 to 1", () => {
    expect(blendFilter(base, LOOK, 3)).toEqual(blendFilter(base, LOOK, 1));
    expect(blendFilter(base, LOOK, -1)).toEqual(base);
  });
});

describe("filterStrength", () => {
  it("reads the strength back from the recipe", () => {
    expect(filterStrength(base, LOOK, blendFilter(base, LOOK, 0.3))).toBeCloseTo(0.3, 6);
    expect(filterStrength(base, LOOK, base)).toBe(0);
  });

  it("is full for a look that changes nothing over this photo", () => {
    const already = blendFilter(base, LOOK, 1);
    expect(filterStrength(already, LOOK, already)).toBe(1);
  });
});

describe("appliedFilter", () => {
  const step = (action: EditHistoryStep["action"], value: string | null, recipe = DEFAULT_RECIPE): EditHistoryStep => ({
    action,
    value,
    at: AT,
    settings: toSparse(recipe),
  });

  it("is none when the step under the cursor is not a look, over the current recipe", () => {
    const history = [step("set", null, base)];
    expect(appliedFilter(history, 0, base)).toEqual({ id: null, base });
    expect(appliedFilter([], -1, DEFAULT_RECIPE)).toEqual({ id: null, base: DEFAULT_RECIPE });
  });

  it("is the look under the cursor, over the recipe before the run of looks", () => {
    const vivid = blendFilter(base, LOOK, 1);
    const history = [step("set", null, base), step("preset", "mono", vivid), step("preset", "vivid", vivid)];
    const applied = appliedFilter(history, 2, vivid);
    expect(applied.id).toBe("vivid");
    expect(applied.base).toEqual(base);
  });

  it("starts from the default recipe when the looks begin the history, and names no look for Original", () => {
    const history = [step("preset", "original")];
    expect(appliedFilter(history, 0, DEFAULT_RECIPE)).toEqual({ id: null, base: DEFAULT_RECIPE });
  });
});
