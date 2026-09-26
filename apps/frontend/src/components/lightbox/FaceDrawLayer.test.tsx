/**
 * The geometry behind marking a face the detector missed (issue #431).
 *
 * The layer reports a box as fractions of the image, which is the only thing
 * the browser can measure and exactly what the backend needs: Face rows store
 * pixels in big-thumbnail space, and multiplying a fraction by the thumbnail's
 * own size gets there without a coordinate mapping.
 */
import { describe, expect, it } from "vitest";
import { boxFromPoints, isBoxBigEnough } from "./FaceDrawLayer";

describe("boxFromPoints", () => {
  it("orders the sides however the drag went", () => {
    const downRight = boxFromPoints({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.8 });
    const upLeft = boxFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });

    expect(downRight).toEqual({ top: 0.3, bottom: 0.8, left: 0.2, right: 0.6 });
    expect(upLeft).toEqual(downRight);
  });

  it("keeps a drag that leaves the photo inside it", () => {
    const box = boxFromPoints({ x: -0.4, y: -0.2 }, { x: 1.5, y: 1.9 });

    expect(box).toEqual({ top: 0, bottom: 1, left: 0, right: 1 });
  });
});

describe("isBoxBigEnough", () => {
  it("rejects a click that did not really drag", () => {
    expect(isBoxBigEnough(boxFromPoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }))).toBe(false);
    expect(isBoxBigEnough(boxFromPoints({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.505 }))).toBe(false);
  });

  it("rejects a drag that is wide but flat, or tall but thin", () => {
    expect(isBoxBigEnough({ top: 0.5, bottom: 0.505, left: 0.1, right: 0.9 })).toBe(false);
    expect(isBoxBigEnough({ top: 0.1, bottom: 0.9, left: 0.5, right: 0.505 })).toBe(false);
  });

  it("accepts a box that plausibly holds a face", () => {
    expect(isBoxBigEnough({ top: 0.3, bottom: 0.6, left: 0.4, right: 0.55 })).toBe(true);
  });
});
