import { describe, expect, it } from "vitest";
import { withControl } from "../engine/controls";
import { DEFAULT_RECIPE, toSparse } from "../engine/recipe";
import { lookOf, pasteLook } from "./copyLook";

describe("copyLook", () => {
  const edited = withControl(
    withControl(withControl(DEFAULT_RECIPE, "light.exposure", 0.5), "geometry.orientation", 90),
    "grading.shadows.sat",
    40
  );

  it("copies everything but the geometry", () => {
    expect(lookOf(edited)).toEqual({ version: 1, light: { exposure: 0.5 }, grading: { shadows: { sat: 40 } } });
  });

  it("pastes the look over a recipe, keeping that photo's own geometry", () => {
    const other = withControl(
      withControl(DEFAULT_RECIPE, "geometry.crop", { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 }),
      "color.vibrance",
      30
    );
    const pasted = pasteLook(other, lookOf(edited));
    expect(pasted.geometry).toEqual(other.geometry);
    // The look replaces the photo's own settings: its vibrance goes.
    expect(toSparse(pasted)).toEqual({
      version: 1,
      geometry: { crop: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 } },
      light: { exposure: 0.5 },
      grading: { shadows: { sat: 40 } },
    });
  });

  it("ignores a geometry in a stored look", () => {
    const pasted = pasteLook(DEFAULT_RECIPE, { version: 1, geometry: { orientation: 180 }, light: { contrast: 5 } });
    expect(pasted.geometry).toEqual(DEFAULT_RECIPE.geometry);
    expect(pasted.light.contrast).toBe(5);
  });
});
