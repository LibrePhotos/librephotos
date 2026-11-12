import { EditRecipe } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import {
  clampControl,
  CONTROL_PATHS,
  isControlPath,
  NUMBER_CONTROLS,
  numberControl,
  readControl,
  readNumber,
  withControl,
} from "./controls";
import { beforeRecipe, changesGeometry, DEFAULT_RECIPE, isIdentity, toDense, toSparse } from "./recipe";

const SPARSE = {
  version: 1,
  geometry: { orientation: 90, crop: { cx: 0.5, cy: 0.5, w: 0.8, h: 0.8 } },
  light: { exposure: 0.35 },
  curve: {
    red: [
      [0, 0.1],
      [1, 0.9],
    ],
  },
  mixer: { orange: { sat: -20 } },
  grading: { shadows: { hue: 220, sat: 30 }, blending: 70 },
  grain: { amount: 10, seed: 42 },
} as const;

describe("dense and sparse recipes", () => {
  it("fills every missing key with its default", () => {
    expect(toDense({ version: 1 })).toEqual(DEFAULT_RECIPE);
    const dense = toDense(EditRecipe.parse(SPARSE));
    expect(dense.light).toEqual({ ...DEFAULT_RECIPE.light, exposure: 0.35 });
    expect(dense.mixer.orange).toEqual({ hue: 0, sat: -20, lum: 0 });
    expect(dense.mixer.red).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(dense.grading.shadows).toEqual({ hue: 220, sat: 30, lum: 0 });
    expect(dense.grading.blending).toBe(70);
    expect(dense.curve.master).toEqual(DEFAULT_RECIPE.curve.master);
  });

  it("keeps only the values that differ, plus the version", () => {
    expect(toSparse(DEFAULT_RECIPE)).toEqual({ version: 1 });
    expect(toSparse(toDense(EditRecipe.parse(SPARSE)))).toEqual(SPARSE);
  });

  it("is the default recipe after a round trip of a full one", () => {
    const dense = toDense(EditRecipe.parse(toSparse(DEFAULT_RECIPE)));
    expect(EditRecipe.safeParse(dense).success).toBe(true);
    expect(dense).toEqual(DEFAULT_RECIPE);
  });

  it("tells an identity recipe and a geometry change", () => {
    expect(isIdentity(DEFAULT_RECIPE)).toBe(true);
    expect(isIdentity(withControl(DEFAULT_RECIPE, "geometry.aspect", "16:9"))).toBe(true);
    expect(isIdentity(withControl(DEFAULT_RECIPE, "light.exposure", 0.1))).toBe(false);
    expect(changesGeometry(DEFAULT_RECIPE)).toBe(false);
    expect(changesGeometry(withControl(DEFAULT_RECIPE, "geometry.flip_v", true))).toBe(true);
    expect(changesGeometry(withControl(DEFAULT_RECIPE, "light.exposure", 1))).toBe(false);
  });

  it("keeps only the geometry for the before view", () => {
    const edited = toDense(EditRecipe.parse(SPARSE));
    expect(beforeRecipe(edited)).toEqual({ ...DEFAULT_RECIPE, geometry: edited.geometry });
  });
});

describe("controls by path", () => {
  it("has the range and default of the doc's table for every number control", () => {
    for (const path of NUMBER_CONTROLS) {
      const spec = numberControl(path);
      expect(readNumber(DEFAULT_RECIPE, path)).toBe(spec.default);
      const sparseAt = (value: number) => toSparse(withValueUnclamped(path, value));
      expect(EditRecipe.safeParse(sparseAt(spec.min)).success).toBe(true);
      expect(EditRecipe.safeParse(sparseAt(spec.max)).success).toBe(true);
      expect(EditRecipe.safeParse(raw(path, spec.min - 0.5)).success).toBe(false);
      expect(EditRecipe.safeParse(raw(path, spec.max + 0.5)).success).toBe(false);
    }
    expect(numberControl("light.exposure")).toEqual({
      path: "light.exposure",
      min: -5,
      max: 5,
      default: 0,
      integer: false,
    });
    expect(numberControl("grading.midtones.hue")).toMatchObject({ min: 0, max: 360 });
    expect(numberControl("grading.global.sat")).toMatchObject({ min: 0, max: 100 });
    expect(numberControl("grain.seed").integer).toBe(true);
  });

  it("sets a control and brings a number into its range", () => {
    const recipe = withControl(DEFAULT_RECIPE, "mixer.aqua.lum", 12);
    expect(recipe.mixer.aqua).toEqual({ hue: 0, sat: 0, lum: 12 });
    expect(withControl(DEFAULT_RECIPE, "light.exposure", 9).light.exposure).toBe(5);
    expect(withControl(DEFAULT_RECIPE, "grain.seed", 7.6).grain.seed).toBe(8);
    expect(clampControl("detail.sharpen_radius", 0)).toBe(0.5);
    expect(withControl(DEFAULT_RECIPE, "color.treatment", "bw").color.treatment).toBe("bw");
    expect(readControl(DEFAULT_RECIPE, "geometry.crop")).toBeNull();
  });

  it("refuses a curve the recipe cannot hold", () => {
    expect(() =>
      withControl(DEFAULT_RECIPE, "curve.master", [
        [0.5, 0],
        [0.5, 1],
      ])
    ).toThrow(RangeError);
  });

  it("knows its paths", () => {
    expect(isControlPath("light.exposure")).toBe(true);
    expect(isControlPath("curve.blue")).toBe(true);
    expect(isControlPath("light.brilliance")).toBe(false);
    expect(new Set(CONTROL_PATHS).size).toBe(CONTROL_PATHS.length);
    expect(NUMBER_CONTROLS).toHaveLength(2 + 6 + 2 + 24 + 8 + 12 + 2 + 3 + 4 + 4 + 4 + 1);
  });
});

/** A dense recipe with one number control set without clamping (the setter clamps). */
function withValueUnclamped(path: (typeof NUMBER_CONTROLS)[number], value: number) {
  return toDense(EditRecipe.parse(raw(path, value)));
}

/** A sparse recipe object with one number at a dotted path. */
function raw(path: string, value: number): Record<string, unknown> {
  const nest = (keys: readonly string[]): unknown => {
    const [key, ...rest] = keys;
    return key === undefined ? value : { [key]: nest(rest) };
  };
  const [group, ...rest] = path.split(".");
  return { version: 1, [group ?? ""]: nest(rest) };
}
