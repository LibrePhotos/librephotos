// `get_rotate_crop_image` (port of lp_ml::ocr::ppocr::warp):
// `cv2.getPerspectiveTransform` (8x8 LU solve) and
// `cv2.warpPerspective(INTER_CUBIC, BORDER_REPLICATE)` as OpenCV 5 runs it
// (the table-free bicubic kernel: f32 weights with A = -0.75, FMA
// accumulation, round half to even), then a 90 degree turn for tall crops.
import { roundTiesEven } from "../preprocess/cv2";
import type { IntQuad } from "./poly";

/** A crop taller than wide by this ratio is turned upright. */
export const ROTATE_ASPECT_THRESHOLD = 1.5;

/** An interleaved 3-channel u8 image (RGB order in the pipeline). */
export interface Image3 {
  w: number;
  h: number;
  data: Uint8Array;
}

const f = Math.fround;

// f32 fused multiply-add: a * b is exact in f64 for f32 inputs, so the only
// error of fround(a * b + c) is a double rounding when the f64 sum lands
// exactly halfway between two f32s; nudge it towards the exact sum then.
const fbuf = new Float64Array(1);
const ubuf = new Uint32Array(fbuf.buffer);
export function fmaf(a: number, b: number, c: number): number {
  const p = a * b;
  const s = p + c;
  const r = f(s);
  if (r === s) return r;
  fbuf[0] = s;
  // f32 keeps 23 of the 52 mantissa bits: a tie has exactly the 29th dropped bit set.
  if ((ubuf[0] & 0x1fffffff) !== 0x10000000) return r;
  const bb = s - p;
  const err = p - (s - bb) + (c - bb);
  if (err === 0) return r;
  ubuf[0] += (err > 0) === (s > 0) ? 1 : -1;
  return f(fbuf[0]);
}

/**
 * `getPerspectiveTransform(src, dst)` with DECOMP_LU; null when the system
 * is singular (OpenCV then falls back to an SVD, which never happens for a
 * detected box).
 */
export function perspectiveTransform(src: [number, number][], dst: [number, number][]): Float64Array | null {
  const a: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const b = new Array<number>(8).fill(0);
  for (let i = 0; i < 4; i++) {
    a[i][0] = a[i + 4][3] = src[i][0];
    a[i][1] = a[i + 4][4] = src[i][1];
    a[i][2] = a[i + 4][5] = 1;
    a[i][6] = f(-src[i][0] * dst[i][0]);
    a[i][7] = f(-src[i][1] * dst[i][0]);
    a[i + 4][6] = f(-src[i][0] * dst[i][1]);
    a[i + 4][7] = f(-src[i][1] * dst[i][1]);
    b[i] = dst[i][0];
    b[i + 4] = dst[i][1];
  }
  const x = luSolve(a, b);
  if (!x) return null;
  const m = new Float64Array(9);
  m.set(x);
  m[8] = 1;
  return m;
}

/** OpenCV's LUImpl (partial pivoting, eps = 100 * DBL_EPSILON). */
function luSolve(a: number[][], b: number[]): number[] | null {
  const M = 8;
  const eps = Number.EPSILON * 100;
  for (let i = 0; i < M; i++) {
    let k = i;
    for (let j = i + 1; j < M; j++) if (Math.abs(a[j][i]) > Math.abs(a[k][i])) k = j;
    if (Math.abs(a[k][i]) < eps) return null;
    if (k !== i) {
      [a[i], a[k]] = [a[k], a[i]];
      [b[i], b[k]] = [b[k], b[i]];
    }
    const d = -1 / a[i][i];
    const pivot = a[i];
    for (let j = i + 1; j < M; j++) {
      const alpha = a[j][i] * d;
      for (let c = i + 1; c < M; c++) a[j][c] += alpha * pivot[c];
      b[j] += alpha * b[i];
    }
  }
  for (let i = M - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < M; k++) s -= a[i][k] * b[k];
    b[i] = s / a[i][i];
  }
  return b;
}

/** `cv::invert` of a 3x3 f64 matrix (the closed form DECOMP_LU uses). */
function invert3(m: Float64Array): Float64Array | null {
  const s = (r: number, c: number) => m[r * 3 + c];
  let d =
    s(0, 0) * (s(1, 1) * s(2, 2) - s(1, 2) * s(2, 1)) -
    s(0, 1) * (s(1, 0) * s(2, 2) - s(1, 2) * s(2, 0)) +
    s(0, 2) * (s(1, 0) * s(2, 1) - s(1, 1) * s(2, 0));
  if (d === 0) return null;
  d = 1 / d;
  return Float64Array.from([
    (s(1, 1) * s(2, 2) - s(1, 2) * s(2, 1)) * d,
    (s(0, 2) * s(2, 1) - s(0, 1) * s(2, 2)) * d,
    (s(0, 1) * s(1, 2) - s(0, 2) * s(1, 1)) * d,
    (s(1, 2) * s(2, 0) - s(1, 0) * s(2, 2)) * d,
    (s(0, 0) * s(2, 2) - s(0, 2) * s(2, 0)) * d,
    (s(0, 2) * s(1, 0) - s(0, 0) * s(1, 2)) * d,
    (s(1, 0) * s(2, 1) - s(1, 1) * s(2, 0)) * d,
    (s(0, 1) * s(2, 0) - s(0, 0) * s(2, 1)) * d,
    (s(0, 0) * s(1, 1) - s(0, 1) * s(1, 0)) * d,
  ]);
}

const A = -0.75;
const A2 = f(A + 2);
const NA3 = f(-(A + 3));

/** bicubicWeights (vector form: w1 with two FMAs), into `out[o..o+4]`. */
function weights(alpha: number, out: Float32Array, o: number) {
  const a2 = f(alpha * alpha);
  const b = f(1 - alpha);
  const b2 = f(b * b);
  const w0 = f(A * f(alpha * b2));
  const w3 = f(A * f(a2 * b));
  const w1 = fmaf(a2, fmaf(A2, alpha, NA3), 1);
  out[o] = w0;
  out[o + 1] = w1;
  out[o + 2] = f(f(f(1 - w0) - w1) - w3);
  out[o + 3] = w3;
}

const replicate = (p: number, len: number) => (p < 0 ? 0 : p > len - 1 ? len - 1 : p);

/** `cv2.warpPerspective(img, M, (dw, dh), INTER_CUBIC, BORDER_REPLICATE)` where `m` maps source to destination. */
export function warpPerspectiveCubic(src: Image3, m: Float64Array, dw: number, dh: number): Image3 {
  const out = new Uint8Array(dw * dh * 3);
  const inv = invert3(m);
  if (!inv) return { w: dw, h: dh, data: out };
  // genericWarp converts the (inverse) matrix to f32.
  const mf = Float32Array.from(inv);
  const sw = src.w;
  const sh = src.h;
  const sd = src.data;
  const bigw = f(Math.max(sw, 16));
  const bigh = f(Math.max(sh, 16));
  const wts = new Float32Array(8);
  const xs4 = new Int32Array(4);
  for (let y = 0; y < dh; y++) {
    const mX = f(f(y * mf[1]) + mf[2]);
    const mY = f(f(y * mf[4]) + mf[5]);
    const mZ = f(f(y * mf[7]) + mf[8]);
    for (let x = 0; x < dw; x++) {
      const invz = 1 / (mZ + mf[6] * x);
      const xs = f((mX + mf[0] * x) * invz);
      const ys = f((mY + mf[3] * x) * invz);
      const vx = xs < -bigw ? -bigw : xs > bigw * 2 ? f(bigw * 2) : xs;
      const vy = ys < -bigh ? -bigh : ys > bigh * 2 ? f(bigh * 2) : ys;
      const ix = Math.floor(vx);
      const iy = Math.floor(vy);
      weights(f(vx - ix), wts, 0);
      weights(f(vy - iy), wts, 4);
      for (let i = 0; i < 4; i++) xs4[i] = replicate(ix - 1 + i, sw);
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let r = 0; r < 4; r++) {
          const row = replicate(iy - 1 + r, sh) * sw;
          const v0 = sd[(row + xs4[0]) * 3 + c];
          const v1 = sd[(row + xs4[1]) * 3 + c];
          const v2 = sd[(row + xs4[2]) * 3 + c];
          const v3 = sd[(row + xs4[3]) * 3 + c];
          let s = fmaf(v1, wts[1], f(v0 * wts[0]));
          s = fmaf(v2, wts[2], s);
          s = fmaf(v3, wts[3], s);
          acc = fmaf(s, wts[4 + r], acc);
        }
        const v = roundTiesEven(acc);
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return { w: dw, h: dh, data: out };
}

/** `np.rot90`: 90 degrees counter-clockwise. */
export function rot90(img: Image3): Image3 {
  const { w, h } = img;
  const data = new Uint8Array(w * h * 3);
  // out[i][j] = in[j][w - 1 - i], out is w rows x h cols
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const s = (j * w + (w - 1 - i)) * 3;
      const d = (i * h + j) * 3;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
    }
  }
  return { w: h, h: w, data };
}

/** PaddleOCR's `get_rotate_crop_image` for a clockwise TL, TR, BR, BL quad. */
export function rotateCrop(img: Image3, quad: IntQuad): Image3 {
  const p = quad.map((q): [number, number] => [q[0], q[1]]);
  const dist = (a: [number, number], b: [number, number]) => {
    const dx = f(a[0] - b[0]);
    const dy = f(a[1] - b[1]);
    return f(Math.sqrt(f(f(dx * dx) + f(dy * dy))));
  };
  const cw = Math.max(Math.trunc(Math.max(dist(p[0], p[1]), dist(p[2], p[3]))), 1);
  const ch = Math.max(Math.trunc(Math.max(dist(p[0], p[3]), dist(p[1], p[2]))), 1);
  const dst: [number, number][] = [
    [0, 0],
    [cw, 0],
    [cw, ch],
    [0, ch],
  ];
  const m = perspectiveTransform(p, dst);
  const crop = m ? warpPerspectiveCubic(img, m, cw, ch) : { w: cw, h: ch, data: new Uint8Array(cw * ch * 3) };
  return crop.w > 0 && crop.h / crop.w >= ROTATE_ASPECT_THRESHOLD ? rot90(crop) : crop;
}
