/**
 * The tone curve editor without React: its points in the unit square (x input, y output, y up),
 * the hit tests of a pointer, and the edits (move, add, remove) that keep a curve the recipe can
 * hold: 2 to 16 points, x strictly increasing with a minimum gap, everything between 0 and 1.
 */
import type { CurvePoints } from "../engine/recipe";
import { evaluateCurve } from "../engine/tables";

export type Point = Readonly<{ x: number; y: number }>;

/** The most points a curve may have (the recipe's limit). */
export const MAX_POINTS = 16;
/** The smallest distance in x between two neighbouring points. */
export const MIN_GAP = 0.01;
/** How far outside the box (in box sizes) a dragged point is let go of to remove it. */
const REMOVE_MARGIN = 0.12;

export const IDENTITY_CURVE: CurvePoints = [
  [0, 0],
  [1, 1],
];

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
/** Four decimals keep the stored recipe short and are finer than any screen. */
const round = (value: number) => Math.round(value * 10000) / 10000;

/** Whether a curve is the straight line from (0, 0) to (1, 1). */
export function isIdentityCurve(points: CurvePoints): boolean {
  return (
    points.length === 2 && points[0]?.[0] === 0 && points[0][1] === 0 && points[1]?.[0] === 1 && points[1][1] === 1
  );
}

/** The point nearest to `p` within `radius`, by its index; null when none is that close. */
export function nearestPoint(points: CurvePoints, p: Point, radius: number): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  points.forEach(([x, y], index) => {
    const distance = Math.hypot(x - p.x, y - p.y);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Whether `p` lies on the drawn curve, within `radius` vertically. */
export function hitsCurve(points: CurvePoints, p: Point, radius: number): boolean {
  if (p.x < 0 || p.x > 1) return false;
  return Math.abs(clamp(evaluateCurve(points, p.x), 0, 1) - p.y) <= radius;
}

/** The range of x a point may take: strictly between its neighbours, the ends inside 0 to 1. */
function xRange(points: CurvePoints, index: number): [min: number, max: number] {
  const before = points[index - 1];
  const after = points[index + 1];
  return [before ? before[0] + MIN_GAP : 0, after ? after[0] - MIN_GAP : 1];
}

/** The curve with one point moved to `to`, kept between its neighbours and inside the box. */
export function movePoint(points: CurvePoints, index: number, to: Point): CurvePoints {
  if (points[index] === undefined) return points;
  const [min, max] = xRange(points, index);
  const moved: [number, number] = [round(clamp(to.x, min, max)), round(clamp(to.y, 0, 1))];
  return points.map((point, i) => (i === index ? moved : point));
}

/** The curve with one point moved by a step (the arrow keys). */
export function nudgePoint(points: CurvePoints, index: number, dx: number, dy: number): CurvePoints {
  const point = points[index];
  return point ? movePoint(points, index, { x: point[0] + dx, y: point[1] + dy }) : points;
}

/**
 * A point added on the curve at `x` (its y is the curve's there, so the curve does not jump), with
 * its index; null when the curve is full or `x` is too close to a point it has.
 */
export function addPoint(points: CurvePoints, x: number): { points: CurvePoints; index: number } | null {
  if (points.length >= MAX_POINTS || x <= 0 || x >= 1) return null;
  const index = points.findIndex(([px]) => px > x);
  if (index <= 0) return null;
  const before = points[index - 1];
  const after = points[index];
  if (!before || !after || x - before[0] < MIN_GAP || after[0] - x < MIN_GAP) return null;
  const added: [number, number] = [round(x), round(clamp(evaluateCurve(points, x), 0, 1))];
  return { points: [...points.slice(0, index), added, ...points.slice(index)], index };
}

/** Whether a point can be removed: not an end point (the curve keeps its two ends). */
export function canRemove(points: CurvePoints, index: number): boolean {
  return index > 0 && index < points.length - 1;
}

/** The curve without one point; unchanged for an end point. */
export function removePoint(points: CurvePoints, index: number): CurvePoints {
  return canRemove(points, index) ? points.filter((_, i) => i !== index) : points;
}

/** Whether a dragged point is far enough outside the box to be removed when let go. */
function isFarOutside(p: Point): boolean {
  return p.x < -REMOVE_MARGIN || p.x > 1 + REMOVE_MARGIN || p.y < -REMOVE_MARGIN || p.y > 1 + REMOVE_MARGIN;
}

/**
 * Where a dragged point goes: moved from where the drag started, or removed while it is far outside
 * the box (and comes back when the pointer does).
 */
export function dragPoint(start: CurvePoints, index: number, to: Point): { points: CurvePoints; removed: boolean } {
  if (isFarOutside(to) && canRemove(start, index)) return { points: removePoint(start, index), removed: true };
  return { points: movePoint(start, index, to), removed: false };
}

/** The drawn curve: `count` samples of the engine's own interpolation, clamped as its table is. */
export function curveSamples(points: CurvePoints, count = 128): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = i / count;
    return { x, y: clamp(evaluateCurve(points, x), 0, 1) };
  });
}
