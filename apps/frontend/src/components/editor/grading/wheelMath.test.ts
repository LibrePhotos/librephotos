import { describe, expect, it } from "vitest";
import { nudgeWheel, paintWheel, wheelPoint, wheelValue } from "./wheelMath";

describe("wheelMath", () => {
  it("puts the hue on the angle and the amount on the radius, counter-clockwise from the right", () => {
    const point = wheelPoint({ hue: 90, sat: 50 });
    expect(point.x).toBeCloseTo(0, 9);
    expect(point.y).toBeCloseTo(0.5, 9);
    expect(wheelValue({ x: -0.3, y: 0 })).toEqual({ hue: 180, sat: 30 });
    expect(wheelValue({ x: 0, y: -1 })).toEqual({ hue: 270, sat: 100 });
  });

  it("round-trips a value and counts outside the disc as its rim", () => {
    expect(wheelValue(wheelPoint({ hue: 213, sat: 64 }))).toEqual({ hue: 213, sat: 64 });
    expect(wheelValue({ x: 3, y: 0 })).toEqual({ hue: 0, sat: 100 });
  });

  it("nudges the hue round the circle and the amount within 0 to 100", () => {
    expect(nudgeWheel({ hue: 359, sat: 10 }, "ArrowLeft", false)).toEqual({ hue: 0, sat: 10 });
    expect(nudgeWheel({ hue: 5, sat: 10 }, "ArrowRight", true)).toEqual({ hue: 355, sat: 10 });
    expect(nudgeWheel({ hue: 5, sat: 95 }, "ArrowUp", true)).toEqual({ hue: 5, sat: 100 });
    expect(nudgeWheel({ hue: 5, sat: 3 }, "ArrowDown", true)).toEqual({ hue: 5, sat: 0 });
    expect(nudgeWheel({ hue: 5, sat: 3 }, "Enter", false)).toBeNull();
  });

  it("paints a grey centre, the hue's colour at the rim, and nothing outside", () => {
    const size = 64;
    const pixels = paintWheel(size);
    const at = (i: number, j: number) => Array.from(pixels.slice((j * size + i) * 4, (j * size + i) * 4 + 4));
    const [r, g, b, a] = at(32, 32);
    expect(a).toBe(255);
    expect(Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0)).toBeLessThan(12);
    expect(at(0, 0)[3]).toBe(0);
    // Right of the centre is hue 0 (pink-red), above it hue 90 (yellow-green), left 180 (teal).
    const right = at(61, 32);
    expect(right[0] ?? 0).toBeGreaterThan(right[1] ?? 0);
    const left = at(2, 32);
    expect(left[1] ?? 0).toBeGreaterThan(left[0] ?? 0);
    const top = at(32, 2);
    expect(top[2] ?? 0).toBeLessThan(top[1] ?? 0);
  });
});
