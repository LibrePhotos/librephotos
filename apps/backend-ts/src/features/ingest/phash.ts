// imagehash.phash(img, hash_size=8) as api/perceptual_hash.py calls it on
// the big WebP thumbnail (port of lp-ingest phash.rs), step by step so the
// hashes match Python bit for bit: Pillow's fixed-point RGB->L, Pillow's
// two-pass LANCZOS resample to 32x32 (8-bit fixed-point coefficients), a
// type-II DCT over both axes, and numpy's median of the top-left 8x8 block.

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;

/** Pillow ImagingConvert RGB -> L: (r*19595 + g*38470 + b*7471 + 0x8000) >> 16. */
export function luma(px: Uint8Array, channels: number): Uint8Array {
  const n = Math.floor(px.length / channels);
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += channels) out[i] = (px[j] * 19595 + px[j + 1] * 38470 + px[j + 2] * 7471 + 0x8000) >>> 16;
  return out;
}

const sinc = (x: number) => {
  if (x === 0) return 1;
  x *= Math.PI;
  return Math.sin(x) / x;
};
const lanczos = (x: number) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);
const bicubic = (x: number) => {
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
};

export interface Coeffs {
  ksize: number;
  xmin: Int32Array;
  n: Int32Array;
  kk: Float64Array; // integer-valued fixed-point coefficients
}

/** precompute_coeffs + normalize_coeffs_8bpc from Pillow's Resample.c. */
export function precompute(inSize: number, in0: number, in1: number, outSize: number, filter: "lanczos" | "bicubic"): Coeffs {
  const f = filter === "lanczos" ? lanczos : bicubic;
  const support0 = filter === "lanczos" ? 3 : 2;
  const scale = (in1 - in0) / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = support0 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize);
  const xminA = new Int32Array(outSize);
  const nA = new Int32Array(outSize);
  const ss = 1 / filterscale;
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    const n = Math.max(0, xmax - xmin);
    let ww = 0;
    const base = xx * ksize;
    for (let x = 0; x < n; x++) {
      const w = f((x + xmin - center + 0.5) * ss);
      kk[base + x] = w;
      ww += w;
    }
    for (let x = 0; x < n; x++) {
      const v = ww !== 0 ? kk[base + x] / ww : kk[base + x];
      kk[base + x] = v < 0 ? Math.trunc(-0.5 + v * ONE) : Math.trunc(0.5 + v * ONE);
    }
    xminA[xx] = xmin;
    nA[xx] = n;
  }
  return { ksize, xmin: xminA, n: nA, kk };
}

const MAX = ONE * 256;
export const clip8 = (v: number) => (v >= MAX ? 255 : v <= 0 ? 0 : Math.floor(v / ONE));

/** Image.resize((ow, oh), LANCZOS) on an L image (ImagingResampleInner). */
export function resizeLanczosL(src: Uint8Array, w: number, h: number, ow: number, oh: number): Uint8Array {
  const horiz = precompute(w, 0, w, ow, "lanczos");
  const vert = precompute(h, 0, h, oh, "lanczos");
  const first = vert.xmin[0];
  const last = vert.xmin[oh - 1] + vert.n[oh - 1];
  let cur = src;
  let cw = w;
  let rowOffset = 0;
  if (ow !== w) {
    const th = last - first;
    const tmp = new Uint8Array(ow * th);
    for (let yy = 0; yy < th; yy++) {
      const row = (yy + first) * w;
      for (let xx = 0; xx < ow; xx++) {
        const xmin = horiz.xmin[xx];
        const n = horiz.n[xx];
        const kb = xx * horiz.ksize;
        let s = ONE / 2;
        for (let x = 0; x < n; x++) s += src[row + xmin + x] * horiz.kk[kb + x];
        tmp[yy * ow + xx] = clip8(s);
      }
    }
    cur = tmp;
    cw = ow;
    rowOffset = first;
  }
  if (oh === h) return cur;
  const out = new Uint8Array(cw * oh);
  for (let yy = 0; yy < oh; yy++) {
    const ymin = vert.xmin[yy] - rowOffset;
    const n = vert.n[yy];
    const kb = yy * vert.ksize;
    for (let xx = 0; xx < cw; xx++) {
      let s = ONE / 2;
      for (let y = 0; y < n; y++) s += cur[(y + ymin) * cw + xx] * vert.kk[kb + y];
      out[yy * cw + xx] = clip8(s);
    }
  }
  return out;
}

const COS32 = (() => {
  const t = new Float64Array(32 * 32);
  for (let k = 0; k < 32; k++) for (let i = 0; i < 32; i++) t[k * 32 + i] = Math.cos((Math.PI * k * (2 * i + 1)) / 64);
  return t;
})();

/** scipy.fftpack.dct type II, unnormalized, of 32 values (first `nOut` outputs). */
function dct32(input: Float64Array, out: Float64Array, nOut: number) {
  for (let k = 0; k < nOut; k++) {
    let s = 0;
    const b = k * 32;
    for (let i = 0; i < 32; i++) s += input[i] * COS32[b + i];
    out[k] = 2 * s;
  }
}

/** pHash of an 8-bit L image as imagehash's hex string. */
export function phashLuma(l: Uint8Array, w: number, h: number): string {
  const small = resizeLanczosL(l, w, h, 32, 32);
  const cols = new Float64Array(32 * 32);
  const colIn = new Float64Array(32);
  const colOut = new Float64Array(32);
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 32; y++) colIn[y] = small[y * 32 + x];
    // Only the first 8 rows of the column DCT feed the low block.
    dct32(colIn, colOut, 8);
    for (let y = 0; y < 8; y++) cols[y * 32 + x] = colOut[y];
  }
  const low = new Float64Array(64);
  const rowOut = new Float64Array(32);
  for (let y = 0; y < 8; y++) {
    dct32(cols.subarray(y * 32, y * 32 + 32), rowOut, 8);
    for (let x = 0; x < 8; x++) low[y * 8 + x] = rowOut[x];
  }
  const sorted = Float64Array.from(low).sort();
  const med = (sorted[31] + sorted[32]) / 2;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 32; i++) hi = (hi * 2 + (low[i] > med ? 1 : 0)) >>> 0;
  for (let i = 32; i < 64; i++) lo = (lo * 2 + (low[i] > med ? 1 : 0)) >>> 0;
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/** pHash of decoded RGB/RGBA pixels (Pillow converts RGBA to RGB, then L). */
export const phashRgb = (px: Uint8Array, channels: number, w: number, h: number) => phashLuma(luma(px, channels), w, h);
