import { describe, expect, it } from "vitest";
import { outputToSource } from "../engine/geometry";
import { DEFAULT_RECIPE, type GeometrySettings } from "../engine/recipe";
import { invertAspect, mirror, turnQuarter } from "./quarterTurn";

const SOURCE = { width: 400, height: 300 };
const CROPPED: GeometrySettings = {
  ...DEFAULT_RECIPE.geometry,
  orientation: 90,
  flip_h: true,
  straighten: 7.5,
  crop: { cx: 0.4, cy: 0.55, w: 0.5, h: 0.3 },
  aspect: "4:5",
};

/** Where an output position of a geometry reads the source. */
const at = (geometry: GeometrySettings, u: number, v: number) => outputToSource(geometry, SOURCE, u, v);

function expectSamePoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

const POINTS = [
  [0.1, 0.2],
  [0.5, 0.5],
  [0.9, 0.3],
  [0.25, 0.85],
] as const;

describe("turnQuarter", () => {
  it("gives the starting geometry back after four right turns, and four left turns", () => {
    let right = CROPPED;
    let left = CROPPED;
    for (let i = 0; i < 4; i++) {
      right = turnQuarter(right, "right");
      left = turnQuarter(left, "left");
    }
    expect(right).toEqual(CROPPED);
    expect(left).toEqual(CROPPED);
  });

  it("leaves a crop unchanged after a turn and the turn back", () => {
    expect(turnQuarter(turnQuarter(CROPPED, "right"), "left")).toEqual(CROPPED);
    expect(turnQuarter(turnQuarter(CROPPED, "left"), "right")).toEqual(CROPPED);
  });

  it("shows the same part of the picture, turned clockwise", () => {
    const turned = turnQuarter(CROPPED, "right");
    // The turned output's (u, v) is the old output's (v, 1 - u).
    for (const [u, v] of POINTS) expectSamePoint(at(turned, u, v), at(CROPPED, v, 1 - u));
  });

  it("shows the same part of the picture, turned counter-clockwise", () => {
    const turned = turnQuarter(CROPPED, "left");
    for (const [u, v] of POINTS) expectSamePoint(at(turned, u, v), at(CROPPED, 1 - v, u));
  });

  it("keeps the whole picture uncropped and swaps the aspect lock", () => {
    const turned = turnQuarter({ ...DEFAULT_RECIPE.geometry, aspect: "16:9" }, "right");
    expect(turned.crop).toBeNull();
    expect(turned.orientation).toBe(90);
    expect(turned.aspect).toBe("9:16");
  });
});

describe("mirror", () => {
  it("shows the same part of the picture, mirrored", () => {
    const horizontal = mirror(CROPPED, "horizontal");
    const vertical = mirror(CROPPED, "vertical");
    for (const [u, v] of POINTS) {
      expectSamePoint(at(horizontal, u, v), at(CROPPED, 1 - u, v));
      expectSamePoint(at(vertical, u, v), at(CROPPED, u, 1 - v));
    }
  });

  it("gives the starting geometry back when done twice", () => {
    expect(mirror(mirror(CROPPED, "horizontal"), "horizontal")).toEqual(CROPPED);
    expect(mirror(mirror(CROPPED, "vertical"), "vertical")).toEqual(CROPPED);
  });

  it("never writes a negative zero straighten angle", () => {
    expect(Object.is(mirror(DEFAULT_RECIPE.geometry, "horizontal").straighten, 0)).toBe(true);
  });
});

describe("invertAspect", () => {
  it("turns each ratio the other way round and keeps free, original and square", () => {
    expect(invertAspect("4:3")).toBe("3:4");
    expect(invertAspect("10:16")).toBe("16:10");
    expect(invertAspect(null)).toBeNull();
    expect(invertAspect("original")).toBe("original");
    expect(invertAspect("1:1")).toBe("1:1");
  });
});
