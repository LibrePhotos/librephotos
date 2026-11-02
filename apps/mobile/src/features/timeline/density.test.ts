import { DENSITIES, DEFAULT_DENSITY_LEVEL, groupKey, levelAfterPinch, parseDensityLevel } from "./density";

describe("timeline density", () => {
  it("steps one level per pinch, within bounds", () => {
    expect(levelAfterPinch(1, 1.6)).toBe(0); // pinch out: bigger photos
    expect(levelAfterPinch(0, 2)).toBe(0);
    expect(levelAfterPinch(1, 0.5)).toBe(2); // pinch in: smaller tiles
    expect(levelAfterPinch(DENSITIES.length - 1, 0.3)).toBe(DENSITIES.length - 1);
    expect(levelAfterPinch(2, 1.05)).toBe(2); // too small a pinch does nothing
  });

  it("groups a day by day, month or year", () => {
    expect(groupKey("2021-02-27", "day")).toBe("2021-02-27");
    expect(groupKey("2021-02-27", "month")).toBe("2021-02");
    expect(groupKey("2021-02-27", "year")).toBe("2021");
  });

  it("reads a saved level and falls back on anything else", () => {
    expect(parseDensityLevel("2")).toBe(2);
    expect(parseDensityLevel(null)).toBe(DEFAULT_DENSITY_LEVEL);
    expect(parseDensityLevel("9")).toBe(DEFAULT_DENSITY_LEVEL);
    expect(parseDensityLevel("x")).toBe(DEFAULT_DENSITY_LEVEL);
  });
});
