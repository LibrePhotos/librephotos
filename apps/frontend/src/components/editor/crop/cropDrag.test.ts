import { describe, expect, it } from "vitest";
import { DEFAULT_RECIPE } from "../engine/recipe";
import { aspectRatio, dragCrop, nudgeDelta, settleCrop, withAspect, withStraighten } from "./cropDrag";

const SOURCE = { width: 400, height: 200 };
const FRAME = { x: 200, y: 100, width: 200, height: 100 };

describe("aspectRatio", () => {
  it("reads a ratio, the picture's own for original, none for free", () => {
    expect(aspectRatio("16:9", SOURCE)).toBeCloseTo(16 / 9, 9);
    expect(aspectRatio("4:5", SOURCE)).toBe(0.8);
    expect(aspectRatio("original", SOURCE)).toBe(2);
    expect(aspectRatio(null, SOURCE)).toBeNull();
  });
});

describe("dragCrop", () => {
  it("moves the whole frame", () => {
    expect(dragCrop(FRAME, "move", { x: 10, y: -5 }, null, 4)).toEqual({ ...FRAME, x: 210, y: 95 });
  });

  it("pulls one edge and keeps the opposite one", () => {
    const pulled = dragCrop(FRAME, "e", { x: 20, y: 99 }, null, 4);
    expect(pulled).toEqual({ x: 210, y: 100, width: 220, height: 100 });
  });

  it("never turns the frame inside out", () => {
    const pulled = dragCrop(FRAME, "w", { x: 500, y: 0 }, null, 4);
    expect(pulled.width).toBe(4);
    expect(pulled.x + pulled.width / 2).toBe(300);
  });

  it("keeps a locked ratio from a corner, anchored at the opposite corner", () => {
    const pulled = dragCrop(FRAME, "se", { x: 40, y: 0 }, 2, 4);
    expect(pulled.width / pulled.height).toBeCloseTo(2, 9);
    expect(pulled.x - pulled.width / 2).toBe(100);
    expect(pulled.y - pulled.height / 2).toBe(50);
    expect(pulled.width).toBe(240);
  });

  it("keeps a locked ratio from an edge, centred across it", () => {
    const pulled = dragCrop(FRAME, "s", { x: 0, y: 20 }, 2, 4);
    expect(pulled.height).toBe(120);
    expect(pulled.width).toBe(240);
    expect(pulled.x).toBe(200);
  });
});

describe("settleCrop, withAspect and withStraighten", () => {
  it("keeps a frame dragged off the picture inside it", () => {
    const crop = settleCrop({ x: 380, y: 100, width: 100, height: 100 }, DEFAULT_RECIPE.geometry, SOURCE);
    expect(crop.cx + crop.w / 2).toBeLessThanOrEqual(1 + 1e-9);
    expect(crop.w).toBeCloseTo(0.25, 9);
  });

  it("locks the aspect to the largest centred crop of that ratio", () => {
    const geometry = withAspect(DEFAULT_RECIPE.geometry, "1:1", SOURCE);
    expect(geometry.aspect).toBe("1:1");
    expect(geometry.crop).toEqual({ cx: 0.5, cy: 0.5, w: 0.5, h: 1 });
    expect(withAspect(geometry, null, SOURCE)).toEqual({ ...geometry, aspect: null });
  });

  it("shrinks a crop the straightened picture no longer holds, and leaves no crop alone", () => {
    const full = { ...DEFAULT_RECIPE.geometry, crop: { cx: 0.5, cy: 0.5, w: 1, h: 1 } };
    const turned = withStraighten(full, 10, SOURCE);
    expect(turned.straighten).toBe(10);
    expect(turned.crop?.w).toBeLessThan(1);
    expect((turned.crop?.w ?? 0) / (turned.crop?.h ?? 1)).toBeCloseTo(1, 9);
    expect(withStraighten(DEFAULT_RECIPE.geometry, -5, SOURCE).crop).toBeNull();
  });
});

describe("nudgeDelta", () => {
  it("moves by a hundredth of the frame, a tenth with Shift, and ignores other keys", () => {
    expect(nudgeDelta("ArrowRight", false, SOURCE)).toEqual({ x: 4, y: 0 });
    expect(nudgeDelta("ArrowUp", true, SOURCE)).toEqual({ x: 0, y: -20 });
    expect(nudgeDelta("Enter", false, SOURCE)).toBeNull();
  });
});
