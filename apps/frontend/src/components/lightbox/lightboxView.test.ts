import { describe, expect, it } from "vitest";
import {
  clampView,
  MAX_SCALE,
  panView,
  pinchView,
  swipeTarget,
  toggledView,
  UNZOOMED,
  wheelScale,
  zoomAround,
} from "./lightboxView";

const box = { width: 1000, height: 800 };
const landscape = { width: 1000, height: 600 };

describe("lightbox view", () => {
  it("keeps a zoomed photo over the stage: it pans only as far as it overhangs", () => {
    expect(clampView({ scale: 2, x: 900, y: -900 }, box, landscape)).toEqual({ scale: 2, x: 500, y: -200 });
    expect(clampView({ scale: 1, x: 40, y: 40 }, box, landscape)).toEqual(UNZOOMED);
  });

  it("never zooms out past the fitted photo nor in past the cap", () => {
    expect(clampView({ scale: 0.5, x: 0, y: 0 }, box, landscape).scale).toBe(1);
    expect(clampView({ scale: 9, x: 0, y: 0 }, box, landscape).scale).toBe(MAX_SCALE);
  });

  it("zooms around a point, keeping what is under it in place", () => {
    const view = zoomAround(UNZOOMED, 2, { x: 200, y: 100 }, box, landscape);
    expect(view).toEqual({ scale: 2, x: -200, y: -100 });
    expect(view.x + 2 * 200).toBe(200);
  });

  it("follows the fingers' midpoint while it pinches", () => {
    const view = pinchView(UNZOOMED, 2, { x: 0, y: 0 }, { x: 50, y: 20 }, box, landscape);
    expect(view).toEqual({ scale: 2, x: 50, y: 20 });
  });

  it("pans a zoomed photo by the drag, within its bounds", () => {
    expect(panView({ scale: 2, x: 0, y: 0 }, { x: 30, y: -500 }, box, landscape)).toEqual({ scale: 2, x: 30, y: -200 });
  });

  it("toggles between fitted and 2x around the tapped point", () => {
    const zoomed = toggledView(UNZOOMED, { x: -100, y: 0 }, box, landscape);
    expect(zoomed).toEqual({ scale: 2, x: 100, y: 0 });
    expect(toggledView(zoomed, { x: 0, y: 0 }, box, landscape)).toEqual(UNZOOMED);
  });

  it("zooms in on a wheel turned up, and faster for a trackpad pinch", () => {
    expect(wheelScale(UNZOOMED, -100, false)).toBeGreaterThan(1);
    expect(wheelScale(UNZOOMED, 100, false)).toBeLessThan(1);
    expect(wheelScale(UNZOOMED, -10, true)).toBeGreaterThan(wheelScale(UNZOOMED, -10, false));
  });

  it("steps on a long swipe or a fling, and springs back from a short slow one", () => {
    expect(swipeTarget(-300, -0.1, 1000)).toBe(1);
    expect(swipeTarget(300, 0.1, 1000)).toBe(-1);
    expect(swipeTarget(-60, -0.8, 1000)).toBe(1);
    expect(swipeTarget(-60, -0.2, 1000)).toBe(0);
    expect(swipeTarget(-60, 0.9, 1000)).toBe(0);
  });
});
