// insightface `face_align.norm_crop`: a similarity transform from the five
// landmarks onto `arcface_dst` (skimage's Umeyama estimate, in closed form),
// then `cv2.warpAffine(img, M, (size, size), borderValue=0)` with OpenCV 5's
// float bilinear kernel. Port of lp_ml::face::align.
import { roundEven } from "../preprocess/cv2";
import type { Kps } from "./scrfd";

const f32 = Math.fround;

/** `arcface_dst` (float32 literals). */
export const ARCFACE_DST: Kps = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
].map(([x, y]) => [f32(x), f32(y)] as [number, number]);

/** `estimate_norm(lmk, image_size)`: the 2x3 matrix image -> crop, null when the landmarks are degenerate. */
export function estimateNorm(lmk: Kps, imageSize: number): number[] | null {
  let ratio: number;
  let diffX: number;
  if (imageSize % 112 === 0) {
    ratio = f32(imageSize / 112);
    diffX = 0;
  } else {
    ratio = f32(imageSize / 128);
    diffX = f32(8 * ratio);
  }
  const dst = ARCFACE_DST.map(([x, y]) => [f32(f32(x * ratio) + diffX), f32(y * ratio)]);
  const n = lmk.length;
  const mean = (pts: number[][]) => {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / n, sy / n];
  };
  const sm = mean(lmk);
  const dm = mean(dst);
  let a00 = 0;
  let a01 = 0;
  let a10 = 0;
  let a11 = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const sx = lmk[i][0] - sm[0];
    const sy = lmk[i][1] - sm[1];
    const dx = dst[i][0] - dm[0];
    const dy = dst[i][1] - dm[1];
    a00 += dx * sx;
    a01 += dx * sy;
    a10 += dy * sx;
    a11 += dy * sy;
    v += sx * sx + sy * sy;
  }
  const p = (a00 + a11) / n;
  const q = (a10 - a01) / n;
  const norm = Math.hypot(p, q);
  v /= n;
  if (!(norm > 0 && v > 0 && Number.isFinite(norm))) return null;
  const scale = norm / v;
  const c = p / norm;
  const s = q / norm;
  const m00 = scale * c;
  const m01 = -scale * s;
  const m10 = scale * s;
  const m11 = scale * c;
  const tx = dm[0] - (m00 * sm[0] + m01 * sm[1]);
  const ty = dm[1] - (m10 * sm[0] + m11 * sm[1]);
  return [m00, m01, tx, m10, m11, ty];
}

/** float32 `fma(a, b, c)` (the f32 product is exact in double; one rounding to double, one to float). */
const fmaf = (a: number, b: number, c: number) => f32(a * b + c);

/**
 * `cv2.warpAffine(src, M, (size, size), INTER_LINEAR, BORDER_CONSTANT, 0)` for
 * an 8-bit RGB image, as OpenCV 5 computes it: M inverted in double, cast to
 * float; per row `y*M1 + M2` in float, per pixel `fma(M0, x, row)`; taps
 * outside the image read 0; fma lerps along x then y; round half to even.
 */
export function warpAffine(src: Uint8Array, w: number, h: number, m: number[], size: number): Uint8Array {
  if (src.length !== w * h * 3) throw new Error("RGB buffer size");
  const mi = [...m];
  let d = mi[0] * mi[4] - mi[1] * mi[3];
  d = d !== 0 ? 1 / d : 0;
  const a11 = mi[4] * d;
  const a22 = mi[0] * d;
  mi[0] = a11;
  mi[1] *= -d;
  mi[3] *= -d;
  mi[4] = a22;
  const b1 = -mi[0] * mi[2] - mi[1] * mi[5];
  const b2 = -mi[3] * mi[2] - mi[4] * mi[5];
  mi[2] = b1;
  mi[5] = b2;
  const mf = mi.map(f32);

  const px = (x: number, y: number, c: number) => (x >= 0 && y >= 0 && x < w && y < h ? src[(y * w + x) * 3 + c] : 0);
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const rowX = f32(f32(y * mf[1]) + mf[2]);
    const rowY = f32(f32(y * mf[4]) + mf[5]);
    for (let x = 0; x < size; x++) {
      const sx = fmaf(mf[0], x, rowX);
      const sy = fmaf(mf[3], x, rowY);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const ax = f32(sx - ix);
      const ay = f32(sy - iy);
      for (let c = 0; c < 3; c++) {
        const p00 = px(ix, iy, c);
        const p01 = px(ix + 1, iy, c);
        const p10 = px(ix, iy + 1, c);
        const p11 = px(ix + 1, iy + 1, c);
        const v0 = fmaf(ax, p01 - p00, p00);
        const v1 = fmaf(ax, p11 - p10, p10);
        const v = roundEven(fmaf(ay, f32(v1 - v0), v0));
        out[(y * size + x) * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}
