import { EditCurvePoints } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import type { CurvePoints } from "../engine/recipe";
import { evaluateCurve } from "../engine/tables";
import {
  addPoint,
  canRemove,
  curveSamples,
  dragPoint,
  hitsCurve,
  IDENTITY_CURVE,
  isIdentityCurve,
  MAX_POINTS,
  MIN_GAP,
  movePoint,
  nearestPoint,
  nudgePoint,
  removePoint,
} from "./curveModel";

const S_CURVE: CurvePoints = [
  [0, 0],
  [0.25, 0.18],
  [0.75, 0.84],
  [1, 1],
];

const valid = (points: CurvePoints) => EditCurvePoints.safeParse(points).success;

describe("curveModel", () => {
  it("finds the nearest point within the radius, and the curve between them", () => {
    expect(nearestPoint(S_CURVE, { x: 0.26, y: 0.2 }, 0.05)).toBe(1);
    expect(nearestPoint(S_CURVE, { x: 0.5, y: 0.5 }, 0.05)).toBeNull();
    expect(hitsCurve(S_CURVE, { x: 0.5, y: evaluateCurve(S_CURVE, 0.5) + 0.01 }, 0.03)).toBe(true);
    expect(hitsCurve(S_CURVE, { x: 0.5, y: 0.9 }, 0.03)).toBe(false);
    expect(hitsCurve(S_CURVE, { x: 1.2, y: 1 }, 0.03)).toBe(false);
  });

  it("keeps a moved point strictly between its neighbours and inside the box", () => {
    const moved = movePoint(S_CURVE, 1, { x: 0.9, y: 1.4 });
    expect(moved[1]).toEqual([0.75 - MIN_GAP, 1]);
    expect(valid(moved)).toBe(true);
    const left = movePoint(S_CURVE, 2, { x: -1, y: -1 });
    expect(left[2]).toEqual([0.25 + MIN_GAP, 0]);
  });

  it("moves the end points too, in their order", () => {
    expect(movePoint(S_CURVE, 0, { x: 0.1, y: 0.2 })[0]).toEqual([0.1, 0.2]);
    expect(movePoint(S_CURVE, 0, { x: 0.5, y: 0 })[0]).toEqual([0.25 - MIN_GAP, 0]);
    expect(movePoint(S_CURVE, 3, { x: 0.2, y: 0.9 })[3]).toEqual([0.75 + MIN_GAP, 0.9]);
    expect(movePoint(S_CURVE, 3, { x: 2, y: 0.9 })[3]).toEqual([1, 0.9]);
  });

  it("adds a point on the curve where it is, in x order, up to the limit", () => {
    const added = addPoint(IDENTITY_CURVE, 0.4);
    expect(added).toEqual({
      points: [
        [0, 0],
        [0.4, 0.4],
        [1, 1],
      ],
      index: 1,
    });
    const onS = addPoint(S_CURVE, 0.5);
    expect(onS?.index).toBe(2);
    expect(onS?.points[2]?.[1]).toBeCloseTo(evaluateCurve(S_CURVE, 0.5), 4);
    expect(addPoint(S_CURVE, 0.251)).toBeNull();
    expect(addPoint(S_CURVE, 0)).toBeNull();
    let full: CurvePoints = IDENTITY_CURVE;
    for (let i = 1; i < MAX_POINTS - 1; i++) full = addPoint(full, i / MAX_POINTS)?.points ?? full;
    expect(full).toHaveLength(MAX_POINTS);
    expect(addPoint(full, 0.97)).toBeNull();
    expect(valid(full)).toBe(true);
  });

  it("removes an inner point, never an end", () => {
    expect(removePoint(S_CURVE, 1)).toEqual([S_CURVE[0], S_CURVE[2], S_CURVE[3]]);
    expect(canRemove(S_CURVE, 0)).toBe(false);
    expect(removePoint(S_CURVE, 3)).toBe(S_CURVE);
  });

  it("removes a point dragged far out of the box, and brings it back when it returns", () => {
    expect(dragPoint(S_CURVE, 1, { x: 0.2, y: -0.5 })).toEqual({ points: removePoint(S_CURVE, 1), removed: true });
    expect(dragPoint(S_CURVE, 1, { x: 0.2, y: -0.05 }).removed).toBe(false);
    // An end point stays at the edge instead.
    expect(dragPoint(S_CURVE, 0, { x: -0.5, y: 0 }).removed).toBe(false);
  });

  it("nudges a point by a step, and samples the curve the engine renders", () => {
    expect(nudgePoint(S_CURVE, 1, 0.01, -0.01)[1]).toEqual([0.26, 0.17]);
    const samples = curveSamples(S_CURVE, 4);
    expect(samples).toHaveLength(5);
    expect(samples[2]?.y).toBeCloseTo(evaluateCurve(S_CURVE, 0.5), 9);
    expect(isIdentityCurve(IDENTITY_CURVE)).toBe(true);
    expect(isIdentityCurve(S_CURVE)).toBe(false);
  });
});
