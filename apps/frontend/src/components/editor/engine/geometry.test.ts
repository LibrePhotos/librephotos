import { describe, expect, it } from "vitest";
import {
  affineToMat3,
  capSize,
  clampCrop,
  cropFromFullFrame,
  cropToPixels,
  defaultCropScale,
  fitView,
  fullFrameLayout,
  largestCrop,
  orientedSize,
  outputSize,
  outputToSource,
  pixelsToCrop,
  sourceTransform,
  type Point,
  type Size,
} from "./geometry";
import { DEFAULT_RECIPE, type GeometrySettings } from "./recipe";

const SOURCE: Size = { width: 4, height: 2 };
const geometry = (patch: Partial<GeometrySettings>): GeometrySettings => ({ ...DEFAULT_RECIPE.geometry, ...patch });

/** Where the centre of output pixel (i, j) reads the source. */
function pixel(g: GeometrySettings, i: number, j: number, source = SOURCE): Point {
  const out = outputSize(g, source);
  return outputToSource(g, source, (i + 0.5) / out.width, (j + 0.5) / out.height);
}

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("orientation and flips", () => {
  it("swaps the size for a quarter turn", () => {
    expect(orientedSize(SOURCE, 0)).toEqual(SOURCE);
    expect(orientedSize(SOURCE, 90)).toEqual({ width: 2, height: 4 });
    expect(orientedSize(SOURCE, 180)).toEqual(SOURCE);
    expect(orientedSize(SOURCE, 270)).toEqual({ width: 2, height: 4 });
    expect(outputSize(geometry({ orientation: 90 }), SOURCE)).toEqual({ width: 2, height: 4 });
  });

  // The output's top-left pixel, and the pixel right of it, in every orientation and flip.
  it.each([
    [{}, { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }],
    [{ orientation: 90 }, { x: 0.5, y: 1.5 }, { x: 0.5, y: 0.5 }],
    [{ orientation: 180 }, { x: 3.5, y: 1.5 }, { x: 2.5, y: 1.5 }],
    [{ orientation: 270 }, { x: 3.5, y: 0.5 }, { x: 3.5, y: 1.5 }],
    [{ flip_h: true }, { x: 3.5, y: 0.5 }, { x: 2.5, y: 0.5 }],
    [{ flip_v: true }, { x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }],
    [
      { orientation: 90, flip_h: true },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1.5 },
    ],
    [
      { orientation: 270, flip_v: true },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1.5 },
    ],
  ] as const)("%o reads the source where the turned picture has it", (patch, topLeft, next) => {
    const g = geometry(patch);
    expectPoint(pixel(g, 0, 0), topLeft);
    expectPoint(pixel(g, 1, 0), next);
  });
});

describe("crop and straighten", () => {
  it("reads the crop's part of the picture", () => {
    const g = geometry({ crop: { cx: 0.25, cy: 0.5, w: 0.5, h: 1 } });
    expect(outputSize(g, SOURCE)).toEqual({ width: 2, height: 2 });
    expectPoint(pixel(g, 0, 0), { x: 0.5, y: 0.5 });
    expectPoint(pixel(g, 1, 1), { x: 1.5, y: 1.5 });
  });

  it("turns the picture clockwise for a positive angle", () => {
    const g = geometry({ straighten: 30, crop: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 } });
    // Right of the centre in the output is up and right in the source.
    const p = outputToSource(g, { width: 2, height: 2 }, 1, 0.5);
    expect(p.x).toBeCloseTo(1 + 0.5 * Math.cos(Math.PI / 6), 9);
    expect(p.y).toBeCloseTo(1 - 0.5 * Math.sin(Math.PI / 6), 9);
  });

  it.each([0, 5, -12, 30, 45, -45])("keeps the default crop inside the picture at %i degrees", degrees => {
    for (const orientation of [0, 90] as const) {
      const g = geometry({ straighten: degrees, orientation });
      const source = { width: 3000, height: 2000 };
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const p = outputToSource(g, source, u, v);
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(source.width + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(source.height + 1e-6);
      }
    }
    expect(defaultCropScale({ width: 3000, height: 2000 }, degrees)).toBeLessThanOrEqual(1);
  });

  it("matches outputToSource with the affine matrix", () => {
    const g = geometry({ orientation: 270, flip_h: true, straighten: 7, crop: { cx: 0.4, cy: 0.6, w: 0.5, h: 0.3 } });
    const source = { width: 640, height: 480 };
    const [a, b, c, d, e, f] = sourceTransform(g, source);
    for (const [u, v] of [
      [0.1, 0.2],
      [0.9, 0.5],
      [0.33, 0.77],
    ] as const) {
      const p = outputToSource(g, source, u, v);
      expect(a * u + b * v + c).toBeCloseTo(p.x / source.width, 9);
      expect(d * u + e * v + f).toBeCloseTo(p.y / source.height, 9);
    }
    expect([...affineToMat3([1, 2, 3, 4, 5, 6])]).toEqual([1, 4, 0, 2, 5, 0, 3, 6, 1]);
  });
});

describe("crop tool helpers", () => {
  it("finds the largest crop of an aspect", () => {
    expect(largestCrop({ width: 4, height: 2 }, 0, 1)).toEqual({ cx: 0.5, cy: 0.5, w: 0.5, h: 1 });
    const turned = largestCrop({ width: 3000, height: 2000 }, 10, 16 / 9);
    const back = clampCrop(turned, { width: 3000, height: 2000 }, 10);
    expect(back.w).toBeCloseTo(turned.w, 9);
    expect((turned.w * 3000) / (turned.h * 2000)).toBeCloseTo(16 / 9, 9);
  });

  it("moves and shrinks a crop so its turned corners stay inside", () => {
    const oriented = { width: 3000, height: 2000 };
    const clamped = clampCrop({ cx: 0.95, cy: 0.1, w: 0.9, h: 0.9 }, oriented, 15);
    const g = geometry({ straighten: 15, crop: clamped });
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const p = outputToSource(g, oriented, u, v);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(3000 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(2000 + 1e-6);
    }
    expect(clamped.w / clamped.h).toBeCloseTo(1, 9);
    const inside = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.3 };
    expect(clampCrop(inside, oriented, 0)).toEqual(inside);
  });

  it("converts a crop between recipe and pixel units", () => {
    const crop = { cx: 0.25, cy: 0.5, w: 0.5, h: 0.25 };
    expect(cropToPixels(crop, { width: 400, height: 200 })).toEqual({ x: 100, y: 100, width: 200, height: 50 });
    expect(pixelsToCrop(cropToPixels(crop, { width: 400, height: 200 }), { width: 400, height: 200 })).toEqual(crop);
  });

  it("lays the full frame out and maps a drawn crop back", () => {
    const flat = fullFrameLayout(geometry({}), SOURCE);
    expect(flat.size).toEqual(SOURCE);
    expect(flat.crop).toEqual({ x: 2, y: 1, width: 4, height: 2 });
    expect(flat.corners).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]);
    const g = geometry({ straighten: 12, orientation: 90, crop: { cx: 0.4, cy: 0.55, w: 0.5, h: 0.4 } });
    const source = { width: 600, height: 400 };
    const layout = fullFrameLayout(g, source);
    const back = cropFromFullFrame(layout.crop, g, source);
    expect(back.cx).toBeCloseTo(0.4, 9);
    expect(back.cy).toBeCloseTo(0.55, 9);
    expect(back.w).toBeCloseTo(0.5, 9);
    // The full-frame render puts the crop's centre where the layout says.
    const frame = outputSize(g, source, true);
    const centre = outputToSource(
      g,
      source,
      layout.crop.x / layout.size.width,
      layout.crop.y / layout.size.height,
      true
    );
    const cropCentre = outputToSource(g, source, 0.5, 0.5);
    expect(frame.width).toBe(Math.round(layout.size.width));
    expect(centre.x).toBeCloseTo(cropCentre.x, 6);
    expect(centre.y).toBeCloseTo(cropCentre.y, 6);
  });
});

describe("sizes and views", () => {
  it("caps a size by its long edge and fits a view", () => {
    expect(capSize({ width: 5000, height: 2500 }, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(capSize({ width: 100, height: 50 }, 2560)).toEqual({ width: 100, height: 50 });
    expect(fitView({ width: 200, height: 200 }, { width: 400, height: 200 })).toEqual({ scale: 0.5, x: 0, y: 50 });
  });
});
