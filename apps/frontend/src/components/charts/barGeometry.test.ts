import { describe, expect, it } from "vitest";
import { barPath, barSlots, slotAt, valueAxis } from "./barGeometry";
import { segmentAt, staySegments } from "./StayBarChart";

describe("valueAxis", () => {
  it.each([
    [0, 1, [0, 1]],
    [1, 1, [0, 1]],
    [3, 3, [0, 1, 2, 3]],
    [7, 8, [0, 2, 4, 6, 8]],
    [10, 12, [0, 3, 6, 9, 12]],
    [1110, 1200, [0, 300, 600, 900, 1200]],
    [312, 400, [0, 100, 200, 300, 400]],
    [437, 600, [0, 200, 400, 600]],
    [1999, 2000, [0, 500, 1000, 1500, 2000]],
    [4200, 6000, [0, 2000, 4000, 6000]],
  ])("counts up to %i in whole, round steps: top %i", (dataMax, max, ticks) => {
    expect(valueAxis(dataMax)).toEqual({ max, ticks });
  });

  it("keeps the top at or above the highest bar, and never more than 4 steps", () => {
    for (let dataMax = 1; dataMax < 5000; dataMax += 37) {
      const axis = valueAxis(dataMax);
      expect(axis.max).toBeGreaterThanOrEqual(dataMax);
      expect(axis.ticks.length - 1).toBeLessThanOrEqual(4);
      expect(axis.ticks.every(Number.isInteger)).toBe(true);
    }
  });
});

describe("barSlots", () => {
  it("splits the width into equal slots, each bar centred and a quarter of its slot narrower", () => {
    expect(barSlots(4, 48, 400, 0.25, 28)).toEqual([
      { slotX: 48, slotWidth: 100, x: 84, width: 28 },
      { slotX: 148, slotWidth: 100, x: 184, width: 28 },
      { slotX: 248, slotWidth: 100, x: 284, width: 28 },
      { slotX: 348, slotWidth: 100, x: 384, width: 28 },
    ]);
    const narrow = barSlots(240, 48, 1920, 0.25, 28);
    expect(narrow[0]).toEqual({ slotX: 48, slotWidth: 8, x: 49, width: 6 });
    expect(narrow.at(-1)?.slotX).toBe(48 + 239 * 8);
  });

  it("finds the slot under the pointer, kept inside the slots", () => {
    expect(slotAt(48, 48, 8, 240)).toBe(0);
    expect(slotAt(48 + 8 * 10 + 7.9, 48, 8, 240)).toBe(10);
    expect(slotAt(0, 48, 8, 240)).toBe(0);
    expect(slotAt(99999, 48, 8, 240)).toBe(239);
    expect(slotAt(50, 48, 8, 0)).toBe(-1);
  });
});

describe("barPath", () => {
  it("draws a bar up from the axis with its top corners rounded", () => {
    expect(barPath(10, 100, 20, 50, 2)).toBe("M10,100V52Q10,50 12,50H28Q30,50 30,52V100Z");
  });

  it("keeps the rounding inside a short or thin bar, and draws nothing for 0", () => {
    expect(barPath(0, 10, 2, 1, 2)).toBe("M0,10V10Q0,9 1,9H1Q2,9 2,10V10Z");
    expect(barPath(0, 10, 20, 0, 2)).toBe("");
  });
});

describe("staySegments", () => {
  it("gives each stay its share of the bar, in order", () => {
    expect(staySegments([30, 10, 60], 5, 200)).toEqual([
      { x: 5, width: 60 },
      { x: 65, width: 20 },
      { x: 85, width: 120 },
    ]);
    expect(staySegments([], 5, 200)).toEqual([]);
    expect(staySegments([0, 0], 5, 200)).toEqual([
      { x: 5, width: 0 },
      { x: 5, width: 0 },
    ]);
  });

  it("finds the stay under the pointer, none outside the bar", () => {
    const segments = staySegments([30, 10, 60], 5, 200);
    expect(segmentAt(segments, 5)).toBe(0);
    expect(segmentAt(segments, 70)).toBe(1);
    expect(segmentAt(segments, 204.9)).toBe(2);
    expect(segmentAt(segments, 2)).toBeNull();
    expect(segmentAt(segments, 205)).toBeNull();
  });
});
