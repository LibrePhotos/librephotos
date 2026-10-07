// `cv2.minAreaRect` + `cv2.boxPoints` as OpenCV 5 computes them (port of
// lp_ml::ocr::ppocr::hull; geometry/src/convhull.cpp, rotcalipers.cpp,
// core/src/types.cpp), float for float: PaddleOCR truncates and floors the
// corners, so an ulp decides which pixel a box starts at.

const f = Math.fround;
const F32_MAX = 3.4028234663852886e38;

/**
 * Hull input points: contours are int32 (CV_32S), the unclipped polygon is
 * cast to float32 (CV_32F), and OpenCV runs a different Sklansky for each.
 * `xy` is flat `[x0, y0, ...]` holding ints or f32 values.
 */
export interface Pts {
  int: boolean;
  xy: ArrayLike<number>;
}

export type Quad = [number, number][];

/** RotatedRect as Python gets it: ((cx, cy), (w, h), angle). */
export interface RotatedRect {
  center: [number, number];
  size: [number, number];
  angle: number;
}

const sign = (v: number) => (v > 0 ? 1 : 0) - (v < 0 ? 1 : 0);

/** `cv::normalize(Vec2f)`: the norm in f32, the scale in f64. */
function normalize(x: number, y: number): [number, number] {
  const s = f(f(x * x) + f(y * y));
  const nv = f(Math.sqrt(s));
  const alpha = nv !== 0 ? 1 / nv : 0;
  return [f(x * alpha), f(y * alpha)];
}

/** `Sklansky_`: one quarter of the hull over `order` from `start` to `end`, written to `stack[base..]`. */
function sklansky(pts: Pts, order: Int32Array, start: number, end: number, stack: Int32Array, base: number, nsign: number, sign2: number): number {
  const incr = end > start ? 1 : -1;
  const xy = pts.xy;
  let pprev = start;
  let pcur = pprev + incr;
  let pnext = pcur + incr;
  let stacksize = 3;
  const as = order[start];
  const ae = order[end];
  if (start === end || (xy[2 * as] === xy[2 * ae] && xy[2 * as + 1] === xy[2 * ae + 1])) {
    stack[base] = start;
    return 1;
  }
  stack[base] = pprev;
  stack[base + 1] = pcur;
  stack[base + 2] = pnext;
  const stop = end + incr;
  while (pnext !== stop) {
    const pc = order[pcur];
    const pn = order[pnext];
    const pp = order[pprev];
    let bySign: number;
    let convex: number;
    let aNonzero: boolean;
    if (pts.int) {
      const cury = xy[2 * pc + 1];
      const by = xy[2 * pn + 1] - cury;
      const ax = xy[2 * pc] - xy[2 * pp];
      const ay = cury - xy[2 * pp + 1];
      const bx = xy[2 * pn] - xy[2 * pc];
      bySign = sign(by);
      convex = sign(ay * bx - ax * by);
      aNonzero = ax !== 0 || ay !== 0;
    } else {
      const cury = xy[2 * pc + 1];
      const by = f(xy[2 * pn + 1] - cury);
      const a = normalize(f(xy[2 * pc] - xy[2 * pp]), f(cury - xy[2 * pp + 1]));
      const b = normalize(f(xy[2 * pn] - xy[2 * pc]), by);
      bySign = sign(by);
      convex = sign(a[1] * b[0] - a[0] * b[1]);
      aNonzero = a[0] !== 0 || a[1] !== 0;
    }
    if (bySign !== nsign) {
      if (convex === sign2 && aNonzero) {
        pprev = pcur;
        pcur = pnext;
        pnext += incr;
        stack[base + stacksize] = pnext;
        stacksize++;
      } else if (pprev === start) {
        pcur = pnext;
        stack[base + 1] = pcur;
        pnext += incr;
        stack[base + 2] = pnext;
      } else {
        stack[base + stacksize - 2] = pnext;
        pcur = pprev;
        pprev = stack[base + stacksize - 4];
        stacksize--;
      }
    } else {
      pnext += incr;
      stack[base + stacksize - 1] = pnext;
    }
  }
  return stacksize - 1;
}

/** `cv::convexHull(points, clockwise=false, returnPoints=true)`: indices into `pts`, in OpenCV's order. */
export function convexHull(pts: Pts): number[] {
  const xy = pts.xy;
  const total = xy.length / 2;
  if (total === 0) return [];
  const order = new Int32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  order.sort((a, b) => xy[2 * a] - xy[2 * b] || xy[2 * a + 1] - xy[2 * b + 1] || a - b);
  const yOf = (i: number) => xy[2 * order[i] + 1];
  let miny = 0;
  let maxy = 0;
  for (let i = 1; i < total; i++) {
    const y = yOf(i);
    if (yOf(miny) > y) miny = i;
    if (yOf(maxy) < y) maxy = i;
  }
  const same = (a: number, b: number) => xy[2 * a] === xy[2 * b] && xy[2 * a + 1] === xy[2 * b + 1];
  if (same(order[0], order[total - 1])) return [0];

  const stack = new Int32Array(2 * total + 8);
  const hull: number[] = [];
  const last = total - 1;
  // upper half (clockwise = false swaps the two stacks)
  const tlCount0 = sklansky(pts, order, 0, maxy, stack, 0, -1, 1);
  const trBase0 = tlCount0;
  const trCount0 = sklansky(pts, order, last, maxy, stack, trBase0, -1, -1);
  const tlBase = trBase0;
  const tlCount = trCount0;
  const trBase = 0;
  const trCount = tlCount0;
  for (let i = 0; i < tlCount - 1; i++) hull.push(stack[tlBase + i]);
  for (let i = trCount - 1; i >= 1; i--) hull.push(stack[trBase + i]);
  const stopIdx = trCount > 2 ? stack[trBase + 1] : tlCount > 2 ? stack[tlBase + tlCount - 2] : -1;
  // lower half
  const blBase = 0;
  let blCount = sklansky(pts, order, 0, miny, stack, blBase, 1, -1);
  const brBase = blCount;
  let brCount = sklansky(pts, order, last, miny, stack, brBase, 1, 1);
  if (stopIdx >= 0) {
    const checkIdx = blCount > 2 ? stack[blBase + 1] : blCount + brCount > 2 ? stack[brBase + 2 - blCount] : -1;
    if (checkIdx === stopIdx || (checkIdx >= 0 && same(order[checkIdx], order[stopIdx]))) {
      blCount = Math.min(blCount, 2);
      brCount = Math.min(brCount, 2);
    }
  }
  for (let i = 0; i < blCount - 1; i++) hull.push(stack[blBase + i]);
  for (let i = brCount - 1; i >= 1; i--) hull.push(stack[brBase + i]);
  let out = hull.map((i) => order[i]);

  // Cyclic shift towards an ascending or descending index sequence.
  const nout = out.length;
  if (nout >= 3) {
    let minIdx = 0;
    let maxIdx = 0;
    let lt = 0;
    for (let i = 1; i < nout; i++) {
      const idx = out[i];
      lt += out[i - 1] < idx ? 1 : 0;
      if (lt > 1 && lt + 2 <= i) break;
      if (idx < out[minIdx]) minIdx = i;
      if (idx > out[maxIdx]) maxIdx = i;
    }
    const mmdist = Math.abs(minIdx - maxIdx);
    if ((mmdist === 1 || mmdist === nout - 1) && (lt <= 1 || lt + 2 >= nout)) {
      const ascending = (maxIdx + 1) % nout === minIdx;
      const i0 = ascending ? minIdx : maxIdx;
      if (i0 > 0) {
        const shifted: number[] = [];
        let j = i0;
        let complete = true;
        for (let i = 0; i < nout; i++) {
          const curr = out[j];
          shifted.push(curr);
          const nextJ = j + 1 < nout ? j + 1 : 0;
          const next = out[nextJ];
          if (i < nout - 1 && ascending !== curr < next) {
            complete = false;
            break;
          }
          j = nextJ;
        }
        if (complete) out = shifted;
      }
    }
  }
  return out;
}

const rotate90cw = (v: [number, number]): [number, number] => [v[1], -v[0]];

function firstVecIsRight(v1: [number, number], v2: [number, number]): boolean {
  const t = rotate90cw(v1);
  return f(f(t[0] * v2[0]) + f(t[1] * v2[1])) < 0;
}

/** `rotatingCalipers(points, n, orientation=1, CALIPERS_MINAREARECT)`; points are f32 `[x, y]`. */
function rotatingCalipers(p: [number, number][]): [[number, number], [number, number], [number, number]] {
  const n = p.length;
  let minarea = F32_MAX;
  const invLen = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  let left = 0;
  let bottom = 0;
  let right = 0;
  let top = 0;
  let pt0 = p[0];
  let leftX = pt0[0];
  let rightX = pt0[0];
  let topY = pt0[1];
  let bottomY = pt0[1];
  for (let i = 0; i < n; i++) {
    if (pt0[0] < leftX) {
      leftX = pt0[0];
      left = i;
    }
    if (pt0[0] > rightX) {
      rightX = pt0[0];
      right = i;
    }
    if (pt0[1] > topY) {
      topY = pt0[1];
      top = i;
    }
    if (pt0[1] < bottomY) {
      bottomY = pt0[1];
      bottom = i;
    }
    const pt = p[i + 1 < n ? i + 1 : 0];
    const dx = f(pt[0] - pt0[0]);
    const dy = f(pt[1] - pt0[1]);
    vx[i] = dx;
    vy[i] = dy;
    invLen[i] = 1 / Math.sqrt(dx * dx + dy * dy);
    pt0 = pt;
  }
  const seq = [bottom, right, top, left];
  let bufIdx0 = 0;
  let bufIdx1 = 0;
  let bufA = 0;
  let bufW = 0;
  let bufB = 0;
  let bufH = 0;
  for (let k = 0; k < n; k++) {
    const rot: [number, number][] = [
      [vx[seq[0]], vy[seq[0]]],
      rotate90cw([vx[seq[1]], vy[seq[1]]]),
      [-vx[seq[2]], -vy[seq[2]]],
      [-vy[seq[3]], vx[seq[3]]],
    ];
    let main = 0;
    for (let i = 1; i < 4; i++) if (firstVecIsRight(rot[i], rot[main])) main = i;
    const pindex = seq[main];
    const leadX = f(vx[pindex] * invLen[pindex]);
    const leadY = f(vy[pindex] * invLen[pindex]);
    let baseA: number;
    let baseB: number;
    switch (main) {
      case 0:
        baseA = leadX;
        baseB = leadY;
        break;
      case 1:
        baseA = leadY;
        baseB = -leadX;
        break;
      case 2:
        baseA = -leadX;
        baseB = -leadY;
        break;
      default:
        baseA = -leadY;
        baseB = leadX;
    }
    seq[main]++;
    if (seq[main] === n) seq[main] = 0;
    let dx = f(p[seq[1]][0] - p[seq[3]][0]);
    let dy = f(p[seq[1]][1] - p[seq[3]][1]);
    const width = f(f(dx * baseA) + f(dy * baseB));
    dx = f(p[seq[2]][0] - p[seq[0]][0]);
    dy = f(p[seq[2]][1] - p[seq[0]][1]);
    const height = f(f(-dx * baseB) + f(dy * baseA));
    const area = f(width * height);
    if (area <= minarea) {
      minarea = area;
      bufIdx0 = seq[3];
      bufIdx1 = seq[0];
      bufA = baseA;
      bufW = width;
      bufB = baseB;
      bufH = height;
    }
  }
  const a1 = bufA;
  const b1 = bufB;
  const a2 = -bufB;
  const b2 = bufA;
  const l = p[bufIdx0];
  const b = p[bufIdx1];
  const c1 = f(f(a1 * l[0]) + f(l[1] * b1));
  const c2 = f(f(a2 * b[0]) + f(b[1] * b2));
  const idet = f(1 / f(f(a1 * b2) - f(a2 * b1)));
  const px = f(f(f(c1 * b2) - f(c2 * b1)) * idet);
  const py = f(f(f(a1 * c2) - f(a2 * c1)) * idet);
  return [
    [px, py],
    [f(a1 * bufW), f(b1 * bufW)],
    [f(a2 * bufH), f(b2 * bufH)],
  ];
}

/** `cv::minAreaRect`. */
export function minAreaRect(pts: Pts): RotatedRect {
  const hull: [number, number][] = convexHull(pts).map((i) => [f(pts.xy[2 * i]), f(pts.xy[2 * i + 1])]);
  const n = hull.length;
  let angle = -Math.PI / 2;
  const r: RotatedRect = { center: [0, 0], size: [0, 0], angle: 0 };
  if (n > 2) {
    const out = rotatingCalipers(hull);
    r.center = [f(out[0][0] + f(f(out[1][0] + out[2][0]) * 0.5)), f(out[0][1] + f(f(out[1][1] + out[2][1]) * 0.5))];
    const len = (v: [number, number]) => f(Math.sqrt(v[0] * v[0] + v[1] * v[1]));
    r.size = [len(out[2]), len(out[1])];
    if (out[1][0] === 0 && out[1][1] > 0) r.size = [r.size[1], r.size[0]];
    else angle = -Math.atan2(out[1][0], out[1][1]);
  } else if (n === 2) {
    r.center = [f(f(hull[0][0] + hull[1][0]) * 0.5), f(f(hull[0][1] + hull[1][1]) * 0.5)];
    const dx = f(hull[0][0] - hull[1][0]);
    const dy = f(hull[0][1] - hull[1][1]);
    r.size = [0, f(Math.sqrt(dx * dx + dy * dy))];
    if (dx === 0) {
      r.size = [r.size[1], r.size[0]];
    } else if (dy < 0) {
      angle = Math.atan2(dy, dx);
      r.size = [r.size[1], r.size[0]];
    } else if (dy > 0) {
      angle = -Math.atan2(dx, dy);
    }
  } else if (n === 1) {
    r.center = hull[0];
  }
  r.angle = f((angle * 180) / Math.PI);
  return r;
}

/** `cv2.boxPoints` (RotatedRect::points). */
export function boxPoints(r: RotatedRect): Quad {
  const a0 = (r.angle * Math.PI) / 180;
  const b = f(f(Math.cos(a0)) * 0.5);
  const a = f(f(Math.sin(a0)) * 0.5);
  const [cx, cy] = r.center;
  const [w, h] = r.size;
  const ah = f(a * h);
  const aw = f(a * w);
  const bh = f(b * h);
  const bw = f(b * w);
  return [
    [f(f(cx - ah) - bw), f(f(cy + bh) - aw)],
    [f(f(cx + ah) - bw), f(f(cy - bh) - aw)],
    [f(f(cx + ah) + bw), f(f(cy - bh) + aw)],
    [f(f(cx - ah) + bw), f(f(cy + bh) + aw)],
  ];
}

/** PaddleOCR's `get_mini_boxes`: the min-area rectangle as TL, TR, BR, BL and its shorter side. */
export function getMiniBoxes(pts: Pts): [Quad, number] {
  const r = minAreaRect(pts);
  // Python's sorted() is stable, like Array.prototype.sort.
  const p = boxPoints(r).sort((u, v) => u[0] - v[0]);
  const [i1, i4] = p[1][1] > p[0][1] ? [0, 1] : [1, 0];
  const [i2, i3] = p[3][1] > p[2][1] ? [2, 3] : [3, 2];
  return [[p[i1], p[i2], p[i3], p[i4]], Math.min(r.size[0], r.size[1])];
}
