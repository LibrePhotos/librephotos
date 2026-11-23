import { describe, expect, it } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { DEFAULT_RECIPE, type CurvePoints } from "./recipe";
import { bandWeights, curveTable, evaluateCurve, hueTable, lightTable, TABLE_SIZE, whiteBalance } from "./tables";

const at = (table: Float32Array, i: number) => defined(table[i], `entry ${i}`);
const light = (patch: Partial<typeof DEFAULT_RECIPE.light>) => lightTable({ ...DEFAULT_RECIPE.light, ...patch });

describe("light table", () => {
  it("is the identity at the defaults, entry i at x = i / 1023", () => {
    const table = light({});
    expect(table).toHaveLength(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) expect(at(table, i)).toBeCloseTo(i / 1023, 6);
  });

  // Expected values from an independent Python transcription of the doc's formula.
  it.each([
    [{ contrast: 100 }, [0, 0.0321247, 0.1561038, 0.4991783, 0.5008217, 0.8762301, 1]],
    [{ blacks: -30, whites: 50, contrast: -40 }, [0, 0.0950648, 0.2684033, 0.5026148, 0.5034815, 0.7794003, 1]],
  ])("follows whites, blacks and contrast (%o)", (patch, expected) => {
    const table = light(patch);
    [0, 100, 256, 511, 512, 800, 1023].forEach((i, n) => expect(at(table, i)).toBeCloseTo(defined(expected[n]), 6));
  });
});

const IDENTITY: CurvePoints = [
  [0, 0],
  [1, 1],
];

describe("tone curve", () => {
  it("is a straight line through two points", () => {
    const line: CurvePoints = [
      [0, 0.2],
      [1, 0.6],
    ];
    expect(evaluateCurve(line, 0.5)).toBeCloseTo(0.4, 12);
    expect(evaluateCurve(IDENTITY, 0.3)).toBeCloseTo(0.3, 12);
  });

  it("uses the Fritsch-Carlson tangents through three points", () => {
    // s = (1.6, 0.4), inner tangent 3 / (1.5 / 1.6 + 1.5 / 0.4) = 0.64, end tangents 1.6 and 0.4.
    const curve: CurvePoints = [
      [0, 0],
      [0.5, 0.8],
      [1, 1],
    ];
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(0.1 + 0.4 - 0.04, 12);
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(0.8, 12);
    // Segment 2 at t = 0.5: 0.5 * 0.8 + 0.125 * 0.5 * 0.64 + 0.5 * 1 - 0.125 * 0.5 * 0.4
    expect(evaluateCurve(curve, 0.75)).toBeCloseTo(0.4 + 0.04 + 0.5 - 0.025, 12);
  });

  it("is flat outside its points", () => {
    const curve: CurvePoints = [
      [0.2, 0.1],
      [0.8, 0.9],
    ];
    expect(evaluateCurve(curve, 0.05)).toBe(0.1);
    expect(evaluateCurve(curve, 0.95)).toBe(0.9);
  });

  it("passes through many points and stays monotone on monotone data", () => {
    const points: CurvePoints = Array.from({ length: 16 }, (_, i): [number, number] => [i / 15, (i / 15) ** 2]);
    for (const [x, y] of points) expect(evaluateCurve(points, x)).toBeCloseTo(y, 12);
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const y = evaluateCurve(points, i / 1000);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = y;
    }
  });

  it("does not overshoot at the turning points of a non-monotone set", () => {
    const curve: CurvePoints = [
      [0, 0],
      [0.3, 0.8],
      [0.6, 0.2],
      [1, 1],
    ];
    for (let i = 0; i <= 300; i++) {
      const y = evaluateCurve(curve, 0.3 + (0.3 * i) / 300);
      expect(y).toBeLessThanOrEqual(0.8 + 1e-12);
      expect(y).toBeGreaterThanOrEqual(0.2 - 1e-12);
    }
  });

  it("builds the table as each channel's curve after the master, interleaved", () => {
    const table = curveTable({
      master: [
        [0, 0],
        [1, 0.5],
      ],
      red: [
        [0, 0],
        [0.5, 1],
        [1, 1],
      ],
      green: IDENTITY,
      blue: [
        [0, 1],
        [1, 0],
      ],
    });
    expect(table).toHaveLength(TABLE_SIZE * 3);
    expect(at(table, 1023 * 3)).toBeCloseTo(1, 6);
    expect(at(table, 1023 * 3 + 1)).toBeCloseTo(0.5, 6);
    expect(at(table, 1023 * 3 + 2)).toBeCloseTo(0.5, 6);
    expect(at(table, 2)).toBeCloseTo(1, 6);
  });

  it("is the identity at the defaults", () => {
    const table = curveTable(DEFAULT_RECIPE.curve);
    for (let i = 0; i < TABLE_SIZE; i++) {
      for (let c = 0; c < 3; c++) expect(at(table, i * 3 + c)).toBeCloseTo(i / 1023, 6);
    }
  });
});

describe("hue table", () => {
  it("weighs the two neighbouring bands by distance, magenta to red included", () => {
    expect(bandWeights(29)).toEqual([0, 1, 0]);
    expect(bandWeights(42)).toEqual([0, 1, 0.5]);
    expect(bandWeights(330)).toEqual([7, 0, 0]);
    const [lower, upper, t] = bandWeights(0);
    expect([lower, upper]).toEqual([7, 0]);
    expect(t).toBeCloseTo(30 / 59, 12);
    expect(bandWeights(359)[2]).toBeCloseTo(29 / 59, 12);
    expect(bandWeights(300)[0]).toBe(6);
  });

  it("is all zeros at the defaults", () => {
    expect(hueTable(DEFAULT_RECIPE.mixer, DEFAULT_RECIPE.bw_mix).every(value => value === 0)).toBe(true);
  });

  it("holds dh in degrees, ds, dl and the B&W weight for each degree", () => {
    const mixer = {
      ...DEFAULT_RECIPE.mixer,
      red: { hue: 100, sat: 0, lum: 50 },
      magenta: { hue: 0, sat: -100, lum: 0 },
    };
    const table = hueTable(mixer, { ...DEFAULT_RECIPE.bw_mix, orange: 80 });
    expect(at(table, 29 * 4)).toBeCloseTo(30, 5);
    expect(at(table, 29 * 4 + 2)).toBeCloseTo(0.5, 6);
    expect(at(table, 0)).toBeCloseTo((30 * 30) / 59, 5);
    expect(at(table, 1)).toBeCloseTo(-29 / 59, 6);
    expect(at(table, 55 * 4 + 3)).toBeCloseTo(0.8, 6);
    expect(at(table, 42 * 4 + 3)).toBeCloseTo(0.4, 6);
    expect(at(table, 200 * 4)).toBe(0);
  });
});

describe("white balance and exposure", () => {
  it("changes nothing at the defaults", () => {
    const { k, gain, M } = whiteBalance(DEFAULT_RECIPE.wb, 0, 1);
    expect([...k].map(v => Number(v.toFixed(6)))).toEqual([1, 1, 1]);
    expect(gain).toBe(1);
    expect(M).toBe(1);
  });

  it("normalises k to keep the luminance and grows M with the largest channel", () => {
    const warm = whiteBalance({ temp: 100, tint: 0 }, 0, 1);
    [1.3968765, 0.9215948, 0.6080258].forEach((v, i) => expect(at(warm.k, i)).toBeCloseTo(v, 6));
    expect(warm.M).toBeCloseTo(1.3968765, 6);
    const raw = whiteBalance({ temp: -50, tint: 30 }, 1, 1.4);
    [0.883179, 1.0005393, 1.3386491].forEach((v, i) => expect(at(raw.k, i)).toBeCloseTo(v, 6));
    expect(raw.gain).toBe(2);
    expect(raw.M).toBeCloseTo(1.4 * 1.3386491 * 2, 5);
    expect(whiteBalance(DEFAULT_RECIPE.wb, -2, 1).M).toBe(1);
  });
});
