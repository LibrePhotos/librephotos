import { describe, expect, it } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { withControl } from "./controls";
import {
  developUniforms,
  finishUniforms,
  needsColor,
  needsFinish,
  needsNoiseReduction,
  needsPlanes,
  planeSize,
  workingSize,
} from "./passes";
import { DEFAULT_RECIPE } from "./recipe";

describe("which stages run", () => {
  it("skips every optional stage at the defaults", () => {
    expect(needsNoiseReduction(DEFAULT_RECIPE)).toBe(false);
    expect(needsPlanes(DEFAULT_RECIPE)).toBe(false);
    expect(needsColor(DEFAULT_RECIPE)).toBe(false);
    expect(needsFinish(DEFAULT_RECIPE)).toBe(false);
  });

  it.each([
    ["detail.nr_color", 10, needsNoiseReduction],
    ["light.shadows", -5, needsPlanes],
    ["effects.texture", 3, needsPlanes],
    ["effects.dehaze", -1, needsPlanes],
    ["mixer.blue.sat", 4, needsColor],
    ["bw_mix.red", 4, needsColor],
    ["grading.balance", 4, needsColor],
    ["color.vibrance", 4, needsColor],
    ["vignette.amount", -4, needsFinish],
    ["grain.amount", 4, needsFinish],
    ["detail.sharpen_amount", 4, needsFinish],
  ] as const)("runs for %s", (path, value, needs) => {
    expect(needs(withControl(DEFAULT_RECIPE, path, value))).toBe(true);
  });

  it("runs the colour stage for black and white, and not for a grain size alone", () => {
    expect(needsColor(withControl(DEFAULT_RECIPE, "color.treatment", "bw"))).toBe(true);
    expect(needsFinish(withControl(DEFAULT_RECIPE, "grain.size", 80))).toBe(false);
  });
});

describe("sizes", () => {
  it("sizes the planes by their long edge", () => {
    expect(planeSize({ width: 2560, height: 1707 }, 256)).toEqual({ width: 256, height: 171 });
    expect(planeSize({ width: 1000, height: 3000 }, 1024)).toEqual({ width: 341, height: 1024 });
    expect(planeSize({ width: 200, height: 100 }, 256)).toEqual({ width: 200, height: 100 });
    expect(planeSize({ width: 5000, height: 2 }, 256)).toEqual({ width: 256, height: 1 });
  });

  it("works at the crop's size in source pixels, capped", () => {
    const cropped = withControl(DEFAULT_RECIPE, "geometry.crop", { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 });
    expect(workingSize(cropped, { width: 2560, height: 1700 }, 8192, false)).toEqual({ width: 1280, height: 850 });
    expect(workingSize(cropped, { width: 2560, height: 1700 }, 8192, true)).toEqual({ width: 2560, height: 1700 });
    expect(workingSize(DEFAULT_RECIPE, { width: 2560, height: 1700 }, 1024, false)).toEqual({
      width: 1024,
      height: 680,
    });
  });
});

describe("uniforms", () => {
  it("packs the develop pass's values", () => {
    let recipe = withControl(DEFAULT_RECIPE, "grading.shadows.hue", 90);
    recipe = withControl(recipe, "grading.shadows.sat", 50);
    recipe = withControl(recipe, "grading.global.lum", -20);
    recipe = withControl(recipe, "light.exposure", 1);
    const uniforms = developUniforms(recipe, 1.4);
    expect(uniforms.gain).toBe(2);
    expect(uniforms.M).toBeCloseTo(2.8, 6);
    expect(defined(uniforms.gradeVectors[0])).toBeCloseTo(0, 6);
    expect(defined(uniforms.gradeVectors[1])).toBeCloseTo(0.5, 6);
    expect(defined(uniforms.gradeLum[3])).toBeCloseTo(-0.2, 6);
    expect(uniforms.useColor).toBe(true);
    expect(uniforms.useLight).toBe(false);
    expect(uniforms.useCurve).toBe(false);
  });

  it("packs the finish pass's values relative to the long edge", () => {
    const uniforms = finishUniforms(withControl(DEFAULT_RECIPE, "grain.size", 100), { width: 1280, height: 800 });
    expect(uniforms.sigma).toBeCloseTo(0.4, 9);
    expect(uniforms.cells).toBe(640);
    expect(uniforms.midpoint).toBe(0.5);
  });
});
