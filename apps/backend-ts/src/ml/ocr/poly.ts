// Polygon helpers of the DB postprocess (port of lp_ml::ocr::ppocr::poly):
// `cv2.fillPoly` (OpenCV 5 drawing.cpp, 8-connected, no shift), PaddleOCR's
// `box_score_fast`, the shoelace area / perimeter and pyclipper's round-join
// offset (Clipper 6.4.2) that `unclip` expands a box with. Integer math that
// is i64 in Rust stays exact in doubles here (coordinates are small); `>>`
// on those values is a floor division.
import type { Quad } from "./hull";

const f = Math.fround;
const ONE = 65536; // 1 << SHIFT
const floorShift = (v: number) => Math.floor(v / ONE);

interface Edge {
  y0: number;
  y1: number;
  x: number;
  dx: number;
  next: number;
}

const NIL = -1;
const HEAD = -2;

/** `cv2.fillPoly(mask, [pts], 1)` on a `w` x `h` u8 mask; `pts` flat int `[x0, y0, ...]`. */
export function fillPoly(mask: Uint8Array, w: number, h: number, pts: number[]) {
  const n = pts.length / 2;
  if (n === 0) return;
  const edges: Edge[] = [];
  let pt0x = pts[2 * (n - 1)] * ONE;
  let pt0y = pts[2 * (n - 1) + 1];
  for (let i = 0; i < n; i++) {
    const pt1x = pts[2 * i] * ONE;
    const pt1y = pts[2 * i + 1];
    const t0 = [floorShift(pt0x + ONE / 2), pt0y];
    const t1 = [floorShift(pt1x + ONE / 2), pt1y];
    line(mask, w, h, t0[0], t0[1], t1[0], t1[1]);
    let c0y = pt0y;
    let c1y = pt1y;
    if (!inside(t0[0], w) || !inside(t1[0], w) || !inside(t0[1], h) || !inside(t1[1], h)) {
      clipLine(w, h, t0, t1);
      if (t0[1] !== t1[1]) {
        c0y = t0[1];
        c1y = t1[1];
      }
    }
    const c0x = t0[0] * ONE;
    const c1x = t1[0] * ONE;
    if (pt0y !== pt1y) {
      const dx = Math.trunc((c1x - c0x) / (c1y - c0y));
      if (pt0y < pt1y) edges.push({ y0: pt0y, y1: pt1y, x: c0x + (pt0y - c0y) * dx, dx, next: NIL });
      else edges.push({ y0: pt1y, y1: pt0y, x: c1x + (pt1y - c1y) * dx, dx, next: NIL });
    }
    pt0x = pt1x;
    pt0y = pt1y;
  }
  fillEdges(mask, w, h, edges);
}

const inside = (v: number, len: number) => v >= 0 && v < len;

/** FillEdgeCollection (the scanline fill with its active edge list). */
function fillEdges(mask: Uint8Array, w: number, h: number, edges: Edge[]) {
  const delta = ONE - 1;
  const total = edges.length;
  if (total < 2) return;
  let yMax = -Infinity;
  let yMin = Infinity;
  let xMax = -1;
  let xMin = Infinity;
  for (const e of edges) {
    const x1 = e.x + (e.y1 - e.y0) * e.dx;
    yMin = Math.min(yMin, e.y0);
    yMax = Math.max(yMax, e.y1);
    xMin = Math.min(xMin, e.x, x1);
    xMax = Math.max(xMax, e.x, x1);
  }
  if (yMax < 0 || yMin >= h || xMax < 0 || xMin >= w * ONE) return;
  edges.sort((a, b) => a.y0 - b.y0 || a.x - b.x || a.dx - b.dx);
  edges.push({ y0: Infinity, y1: 0, x: 0, dx: 0, next: NIL });
  let headNext = NIL;
  let i = 0;
  let e = 0;
  yMax = Math.min(yMax, h);
  const nextOf = (k: number) => (k === HEAD ? headNext : edges[k].next);
  const setNext = (k: number, v: number) => {
    if (k === HEAD) headNext = v;
    else edges[k].next = v;
  };

  for (let y = edges[0].y0; y < yMax; y++) {
    let draw = false;
    const clipline = y < 0;
    let prelast = HEAD;
    let last = headNext;
    while (last !== NIL || edges[e].y0 === y) {
      if (last !== NIL && edges[last].y1 === y) {
        const nx = edges[last].next;
        setNext(prelast, nx);
        last = nx;
        continue;
      }
      const keepPrelast = prelast;
      if (last !== NIL && (edges[e].y0 > y || edges[last].x < edges[e].x)) {
        prelast = last;
        last = edges[last].next;
      } else if (i < total) {
        setNext(prelast, e);
        edges[e].next = last;
        prelast = e;
        i++;
        e = i;
      } else {
        break;
      }
      if (draw) {
        if (!clipline) {
          const kx = edges[keepPrelast].x;
          const px = edges[prelast].x;
          let x1: number;
          let x2: number;
          if (kx > px) {
            x1 = floorShift(px + delta);
            x2 = floorShift(kx);
          } else {
            x1 = floorShift(kx + delta);
            x2 = floorShift(px);
          }
          if (x1 < w && x2 >= 0) {
            x1 = Math.max(x1, 0);
            x2 = Math.min(x2, w - 1);
            if (x1 <= x2) mask.fill(1, y * w + x1, y * w + x2 + 1);
          }
        }
        edges[keepPrelast].x += edges[keepPrelast].dx;
        edges[prelast].x += edges[prelast].dx;
      }
      draw = !draw;
    }

    // bubble sort of the active list by x
    let keepPrelast = NIL;
    for (;;) {
      let pl = HEAD;
      let ls = headNext;
      let lastExchange = NIL;
      while (ls !== keepPrelast && edges[ls].next !== NIL) {
        const te = edges[ls].next;
        if (edges[ls].x > edges[te].x) {
          setNext(pl, te);
          edges[ls].next = edges[te].next;
          edges[te].next = ls;
          pl = te;
          lastExchange = pl;
        } else {
          pl = ls;
          ls = te;
        }
      }
      if (lastExchange === NIL) break;
      keepPrelast = lastExchange;
      if (keepPrelast === nextOf(HEAD) || keepPrelast === HEAD) break;
    }
  }
}

/** OpenCV's `clipLine(Size2l, pt1, pt2)` (mutates both points); true when the result is inside. */
function clipLine(w: number, h: number, p1: number[], p2: number[]): boolean {
  const right = w - 1;
  const bottom = h - 1;
  if (w <= 0 || h <= 0) return false;
  const code = (p: number[]) => (p[0] < 0 ? 1 : 0) + (p[0] > right ? 2 : 0) + (p[1] < 0 ? 4 : 0) + (p[1] > bottom ? 8 : 0);
  let c1 = code(p1);
  let c2 = code(p2);
  if ((c1 & c2) === 0 && (c1 | c2) !== 0) {
    if (c1 & 12) {
      const a = c1 < 8 ? 0 : bottom;
      p1[0] += Math.trunc(((a - p1[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1]));
      p1[1] = a;
      c1 = (p1[0] < 0 ? 1 : 0) + (p1[0] > right ? 2 : 0);
    }
    if (c2 & 12) {
      const a = c2 < 8 ? 0 : bottom;
      p2[0] += Math.trunc(((a - p2[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1]));
      p2[1] = a;
      c2 = (p2[0] < 0 ? 1 : 0) + (p2[0] > right ? 2 : 0);
    }
    if ((c1 & c2) === 0 && (c1 | c2) !== 0) {
      if (c1) {
        const a = c1 === 1 ? 0 : right;
        p1[1] += Math.trunc(((a - p1[0]) * (p2[1] - p1[1])) / (p2[0] - p1[0]));
        p1[0] = a;
        c1 = 0;
      }
      if (c2) {
        const a = c2 === 1 ? 0 : right;
        p2[1] += Math.trunc(((a - p2[0]) * (p2[1] - p1[1])) / (p2[0] - p1[0]));
        p2[0] = a;
        c2 = 0;
      }
    }
  }
  return (c1 | c2) === 0;
}

/** `Line(img, pt1, pt2, color, 8)`: 8-connected Bresenham (LineIterator, leftToRight), clipped. */
function line(mask: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number) {
  let p1 = [ax, ay];
  let p2 = [bx, by];
  if (!inside(p1[0], w) || !inside(p2[0], w) || !inside(p1[1], h) || !inside(p2[1], h)) {
    // cv::clipLine(Size, Point&, Point&) works on int points.
    const q1 = [p1[0] | 0, p1[1] | 0];
    const q2 = [p2[0] | 0, p2[1] | 0];
    if (!clipLine(w, h, q1, q2)) return;
    p1 = [q1[0] | 0, q1[1] | 0];
    p2 = [q2[0] | 0, q2[1] | 0];
  }
  let deltaX = 1;
  let deltaY = 1;
  let dx = p2[0] - p1[0];
  let dy = p2[1] - p1[1];
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
    p1 = p2;
  }
  if (dy < 0) {
    dy = -dy;
    deltaY = -1;
  }
  const vert = dy > dx;
  if (vert) {
    [dx, dy] = [dy, dx];
    [deltaX, deltaY] = [deltaY, deltaX];
  }
  let err = dx - (dy + dy);
  const plusDelta = dx + dx;
  const minusDelta = -(dy + dy);
  let minusShift = deltaX;
  let plusShift = 0;
  let minusStep = 0;
  let plusStep = deltaY;
  if (vert) {
    [plusStep, plusShift] = [plusShift, plusStep];
    [minusStep, minusShift] = [minusShift, minusStep];
  }
  const count = dx + 1;
  let px = p1[0];
  let py = p1[1];
  for (let k = 0; k < count; k++) {
    if (inside(px, w) && inside(py, h)) mask[py * w + px] = 1;
    const neg = err < 0;
    err += minusDelta + (neg ? plusDelta : 0);
    px += minusShift + (neg ? plusShift : 0);
    py += minusStep + (neg ? plusStep : 0);
  }
}

/** PaddleOCR's `box_score_fast`: mean of `prob` inside the (truncated) quad. */
export function boxScoreFast(prob: Float32Array, w: number, h: number, quad: Quad): number {
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (const p of quad) {
    minx = Math.min(minx, p[0]);
    maxx = Math.max(maxx, p[0]);
    miny = Math.min(miny, p[1]);
    maxy = Math.max(maxy, p[1]);
  }
  const clip = (v: number, hi: number) => Math.trunc(Math.min(Math.max(v, 0), hi - 1));
  const xmin = clip(Math.floor(minx), w);
  const xmax = clip(Math.ceil(maxx), w);
  const ymin = clip(Math.floor(miny), h);
  const ymax = clip(Math.ceil(maxy), h);
  const mw = xmax - xmin + 1;
  const mh = ymax - ymin + 1;
  const mask = new Uint8Array(mw * mh);
  const pts: number[] = [];
  for (const p of quad) pts.push(Math.trunc(f(p[0] - xmin)), Math.trunc(f(p[1] - ymin)));
  fillPoly(mask, mw, mh, pts);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < mh; y++) {
    const row = (ymin + y) * w + xmin;
    for (let x = 0; x < mw; x++) {
      if (mask[y * mw + x]) {
        sum += prob[row + x];
        n++;
      }
    }
  }
  return n === 0 ? 0 : sum * (1 / n);
}

/** Shoelace area of a closed polygon (f64). */
export function polygonArea(pts: [number, number][]): number {
  const n = pts.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1];
    b += pts[i][1] * pts[j][0];
  }
  return 0.5 * Math.abs(a - b);
}

export function polygonPerimeter(pts: [number, number][]): number {
  const n = pts.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[i][0] - pts[j][0];
    const dy = pts[i][1] - pts[j][1];
    s += Math.sqrt(dx * dx + dy * dy);
  }
  return s;
}

/**
 * `unclip`: the box grown by `area * ratio / perimeter` with round joins, as
 * pyclipper returns it (union-cleaned: no duplicate or collinear points, the
 * cycle ending at the top-most, right-most vertex). Null when the offset
 * collapses.
 */
export function unclip(quad: Quad, ratio: number): [number, number][] | null {
  const pts = quad.map((p): [number, number] => [p[0], p[1]]);
  const perimeter = polygonPerimeter(pts);
  const distance = perimeter <= 0 ? 0 : (polygonArea(pts) * ratio) / perimeter;
  // pyclipper truncates float coordinates to integers.
  const path = quad.map((p): [number, number] => [Math.trunc(p[0]), Math.trunc(p[1])]);
  const offset = clipperOffset(path, distance);
  if (!offset) return null;
  const out = clean(offset);
  if (out.length < 3) return null;
  let minY = Infinity;
  for (const p of out) minY = Math.min(minY, p[1]);
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    // max_by_key keeps the last of equal maxima
    if (out[i][1] === minY && (last < 0 || out[i][0] >= out[last][0])) last = i;
  }
  const k = (last + 1) % out.length;
  return out.slice(k).concat(out.slice(0, k));
}

const clipperRound = (v: number) => (v < 0 ? Math.trunc(v - 0.5) : Math.trunc(v + 0.5));

function clipperArea(p: [number, number][]): number {
  const n = p.length;
  if (n < 3) return 0;
  let a = 0;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
    j = i;
  }
  return -a * 0.5;
}

function unitNormal(a: [number, number], b: [number, number]): [number, number] {
  if (a[0] === b[0] && a[1] === b[1]) return [0, 0];
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const fct = 1 / Math.sqrt(dx * dx + dy * dy);
  dx *= fct;
  dy *= fct;
  return [dy, -dx];
}

/** ClipperOffset (JT_ROUND, ET_CLOSEDPOLYGON, arc tolerance 0.25) on one path, before the union. */
function clipperOffset(path: [number, number][], delta: number): [number, number][] | null {
  if (path.length === 0) return null;
  let hi = path.length - 1;
  while (hi > 0 && path[0][0] === path[hi][0] && path[0][1] === path[hi][1]) hi--;
  let c: [number, number][] = [path[0]];
  for (let i = 1; i <= hi; i++) {
    const l = c[c.length - 1];
    if (l[0] !== path[i][0] || l[1] !== path[i][1]) c.push(path[i]);
  }
  if (c.length < 3) return null;
  if (clipperArea(c) < 0) c = c.reverse();
  if (Math.abs(delta) < 1e-20) return c;
  const TWO_PI = Math.PI * 2;
  const arcTolerance = 0.25;
  const y0 = arcTolerance > Math.abs(delta) * 0.25 ? Math.abs(delta) * 0.25 : arcTolerance;
  let steps = Math.PI / Math.acos(1 - y0 / Math.abs(delta));
  if (steps > Math.abs(delta) * Math.PI) steps = Math.abs(delta) * Math.PI;
  let sin = Math.sin(TWO_PI / steps);
  const cos = Math.cos(TWO_PI / steps);
  const stepsPerRad = steps / TWO_PI;
  if (delta < 0) sin = -sin;
  const n = c.length;
  const normals: [number, number][] = [];
  for (let j = 0; j < n - 1; j++) normals.push(unitNormal(c[j], c[j + 1]));
  normals.push(unitNormal(c[n - 1], c[0]));
  const at = (j: number, nrm: [number, number]): [number, number] => [clipperRound(c[j][0] + nrm[0] * delta), clipperRound(c[j][1] + nrm[1] * delta)];
  const out: [number, number][] = [];
  let k = n - 1;
  for (let j = 0; j < n; j++) {
    const nk = normals[k];
    const nj = normals[j];
    let sinA = nk[0] * nj[1] - nj[0] * nk[1];
    if (Math.abs(sinA * delta) < 1) {
      const cosA = nk[0] * nj[0] + nj[1] * nk[1];
      if (cosA > 0) {
        out.push(at(j, nk));
        continue;
      }
    } else {
      sinA = Math.min(Math.max(sinA, -1), 1);
    }
    if (sinA * delta < 0) {
      out.push(at(j, nk), c[j], at(j, nj));
    } else {
      const a = Math.atan2(sinA, nk[0] * nj[0] + nk[1] * nj[1]);
      const st = Math.max(clipperRound(stepsPerRad * Math.abs(a)) | 0, 1);
      let x = nk[0];
      let y = nk[1];
      for (let s = 0; s < st; s++) {
        out.push([clipperRound(c[j][0] + x * delta), clipperRound(c[j][1] + y * delta)]);
        const x2 = x;
        x = x * cos - sin * y;
        y = x2 * sin + y * cos;
      }
      out.push(at(j, nj));
    }
    k = j;
  }
  return out;
}

/** What Clipper's union leaves of a simple polygon: no repeated and no collinear vertices. */
function clean(p: [number, number][]): [number, number][] {
  for (;;) {
    if (p.length < 3) return p;
    const n = p.length;
    let found = -1;
    for (let i = 0; i < n; i++) {
      const a = p[(i + n - 1) % n];
      const b = p[i];
      const c = p[(i + 1) % n];
      if ((b[0] === a[0] && b[1] === a[1]) || (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) === 0) {
        found = i;
        break;
      }
    }
    if (found < 0) return p;
    p.splice(found, 1);
  }
}

/** `order_points_clockwise`: by angle around the (f32) centroid, then rotated to start at the smallest x + y. */
export function orderPointsClockwise(pts: Quad): Quad {
  // numpy's float32 mean (pairwise sum of 4 values = sequential).
  const cx = f(f(f(f(pts[0][0] + pts[1][0]) + pts[2][0]) + pts[3][0]) / 4);
  const cy = f(f(f(f(pts[0][1] + pts[1][1]) + pts[2][1]) + pts[3][1]) / 4);
  const ang = pts.map((p) => f(Math.atan2(f(p[1] - cy), f(p[0] - cx))));
  const idx = [0, 1, 2, 3].sort((a, b) => ang[a] - ang[b]);
  const ordered = idx.map((i) => pts[i]);
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (f(ordered[i][0] + ordered[i][1]) < f(ordered[start][0] + ordered[start][1])) start = i;
  }
  return [0, 1, 2, 3].map((i) => ordered[(start + i) % 4]);
}

/** A detected quad (TL, TR, BR, BL) in image coordinates, ints. */
export type IntQuad = [number, number][];

/** `rescale_quad`: from the detection map's size to the image's, rounded half to even in f32 and clipped. */
export function rescaleQuad(b: Quad, size: [number, number], dest: [number, number]): IntQuad {
  const w = f(size[0]);
  const h = f(size[1]);
  const dw = f(dest[0]);
  const dh = f(dest[1]);
  const rte = (x: number) => {
    const fl = Math.floor(x);
    const d = x - fl;
    return d < 0.5 ? fl : d > 0.5 ? fl + 1 : fl % 2 === 0 ? fl : fl + 1;
  };
  return b.map((p): [number, number] => [
    Math.trunc(Math.min(Math.max(rte(f(f(p[0] / w) * dw)), 0), dw)),
    Math.trunc(Math.min(Math.max(rte(f(f(p[1] / h) * dh)), 0), dh)),
  ]);
}
