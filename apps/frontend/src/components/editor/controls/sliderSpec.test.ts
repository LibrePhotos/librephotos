import { describe, expect, it } from "vitest";
import { formatValue, including, parseValue, sliderSpec, snapValue } from "./sliderSpec";

describe("sliderSpec", () => {
  it("steps Exposure in hundredths of a stop and the others in whole numbers", () => {
    expect(sliderSpec("light.exposure")).toMatchObject({ step: 0.01, decimals: 2, bipolar: true, min: -5, max: 5 });
    expect(sliderSpec("light.contrast")).toMatchObject({ step: 1, decimals: 0, bipolar: true, origin: 0 });
    expect(sliderSpec("geometry.straighten")).toMatchObject({ step: 0.1, decimals: 1 });
    expect(sliderSpec("detail.sharpen_radius")).toMatchObject({ step: 0.1, min: 0.5, max: 3, origin: 1 });
    expect(sliderSpec("grain.amount")).toMatchObject({ bipolar: false, min: 0 });
  });

  it("takes a narrower range inside the control's own", () => {
    expect(sliderSpec("light.exposure", { min: -2, max: 2 })).toMatchObject({ min: -2, max: 2 });
    expect(sliderSpec("light.contrast", { min: -500, max: 50 })).toMatchObject({ min: -100, max: 50 });
  });
});

describe("a narrower range and a value outside it", () => {
  const brightness = sliderSpec("light.exposure", { min: -2, max: 2 });

  it("grows to hold the value, so it shows and steps from the real one", () => {
    const grown = including(brightness, 3.5);
    expect([grown.min, grown.max]).toEqual([-2, 3.5]);
    expect(formatValue(grown, 3.5)).toBe("+3.50");
    expect(snapValue(grown, 3.5 + grown.step)).toBe(3.5);
    expect(including(brightness, -4.25).min).toBe(-4.25);
  });

  it("stays as it is for a value inside it", () => {
    expect(including(brightness, 1.5)).toBe(brightness);
  });
});

describe("value formatting", () => {
  const exposure = sliderSpec("light.exposure");
  const contrast = sliderSpec("light.contrast");
  const amount = sliderSpec("grain.amount");

  it("shows the sign of a bipolar value and the control's decimals", () => {
    expect(formatValue(exposure, 0.351)).toBe("+0.35");
    expect(formatValue(exposure, -1)).toBe("-1.00");
    expect(formatValue(exposure, 0)).toBe("0.00");
    expect(formatValue(contrast, 12.4)).toBe("+12");
    expect(formatValue(amount, 12)).toBe("12");
  });

  it("never shows a negative zero", () => {
    expect(formatValue(contrast, -0.2)).toBe("0");
    expect(Object.is(snapValue(contrast, -0.2), 0)).toBe(true);
  });

  it("snaps to the step without float noise and into the range", () => {
    expect(snapValue(sliderSpec("geometry.straighten"), 0.30000000000000004)).toBe(0.3);
    expect(snapValue(contrast, 250)).toBe(100);
    expect(snapValue(contrast, Number.NaN)).toBe(0);
  });

  it("parses a typed value with a comma or a plus, and refuses text", () => {
    expect(parseValue(exposure, "+0,5")).toBe(0.5);
    expect(parseValue(exposure, " -1.234 ")).toBe(-1.23);
    expect(parseValue(contrast, "300")).toBe(100);
    expect(parseValue(contrast, "abc")).toBeNull();
    expect(parseValue(contrast, "")).toBeNull();
    expect(parseValue(contrast, "-")).toBeNull();
  });
});
