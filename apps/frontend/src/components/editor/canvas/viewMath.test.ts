import { describe, expect, it } from "vitest";
import { fitView } from "../engine/geometry";
import { clampPan, FIT, isFitted, MAX_ZOOM, panBy, resolveView, toggleZoom, zoomAround, zoomPercent } from "./viewMath";

const CANVAS = { width: 1000, height: 800 };
const PICTURE = { width: 2000, height: 1000 };
const fitted = fitView(CANVAS, PICTURE);

describe("zoomAround", () => {
  it("keeps the picture point under the pointer in place", () => {
    const anchor = { x: 700, y: 400 };
    const pointAt = (view: { scale: number; x: number; y: number }) => ({
      px: (anchor.x - view.x) / view.scale,
      py: (anchor.y - view.y) / view.scale,
    });
    const zoomed = zoomAround(fitted, 1, anchor, CANVAS, PICTURE);
    expect(zoomed.scale).toBe(1);
    const before = pointAt(fitted);
    const after = pointAt(zoomed);
    expect(after.px).toBeCloseTo(before.px, 6);
    expect(after.py).toBeCloseTo(before.py, 6);
  });

  it("stops at the fitted view and at MAX_ZOOM", () => {
    expect(zoomAround(fitted, 0.01, { x: 0, y: 0 }, CANVAS, PICTURE).scale).toBe(fitted.scale);
    expect(zoomAround(fitted, 100, { x: 0, y: 0 }, CANVAS, PICTURE).scale).toBe(MAX_ZOOM);
  });

  it("lets a picture smaller than the canvas go down to 100 %", () => {
    const small = { width: 100, height: 50 };
    expect(zoomAround(fitView(CANVAS, small), 0.2, { x: 0, y: 0 }, CANVAS, small).scale).toBe(1);
  });
});

describe("panning", () => {
  it("keeps a zoomed picture edge to edge over the canvas", () => {
    const view = { scale: 1, x: 0, y: 0 };
    expect(panBy(view, { x: 300, y: 0 }, CANVAS, PICTURE).x).toBe(0);
    expect(panBy(view, { x: -5000, y: 0 }, CANVAS, PICTURE).x).toBe(CANVAS.width - PICTURE.width);
    expect(panBy(view, { x: -100, y: -50 }, CANVAS, PICTURE)).toEqual({ scale: 1, x: -100, y: -50 });
  });

  it("centres an axis along which the picture is smaller than the canvas", () => {
    expect(clampPan({ scale: 0.5, x: -300, y: 999 }, CANVAS, PICTURE)).toEqual({ scale: 0.5, x: 0, y: 150 });
  });
});

describe("toggleZoom and the readout", () => {
  it("goes from fitted to 100 % around the pointer and back", () => {
    const zoomed = toggleZoom(fitted, { x: 500, y: 400 }, CANVAS, PICTURE);
    expect(zoomed.kind).toBe("manual");
    const view = resolveView(zoomed, CANVAS, PICTURE);
    expect(zoomPercent(view)).toBe(100);
    expect(isFitted(view, CANVAS, PICTURE)).toBe(false);
    expect(toggleZoom(view, { x: 0, y: 0 }, CANVAS, PICTURE)).toEqual(FIT);
  });

  it("follows the canvas while fitted", () => {
    expect(resolveView(FIT, CANVAS, PICTURE, 10)).toEqual(fitView(CANVAS, PICTURE, 10));
    expect(zoomPercent(fitted)).toBe(50);
  });
});
