// imagehash.phash(img, hash_size=8) as api/perceptual_hash.py calls it on
// the big WebP thumbnail, step by step so the hashes match Python bit for
// bit (port of lp_ingest::phash): Pillow's fixed-point RGB->L, Pillow's
// two-pass LANCZOS resample to 32x32 (8-bit fixed-point coefficients), a
// type-II DCT over both axes, and numpy's median of the top-left 8x8 block.
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

interface Coeffs {
  ksize: number;
  bounds: [number, number][];
  kk: Int32Array;
}

/** precompute_coeffs + normalize_coeffs_8bpc from Pillow's Resample.c. */
function precompute(inSize: number, in0: number, in1: number, outSize: number): Coeffs {
  const scale = (Math.fround(in1) - Math.fround(in0)) / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = 3 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const prekk = new Float64Array(outSize * ksize);
  const bounds: [number, number][] = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax = Math.max(xmax - xmin, 0);
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      prekk[xx * ksize + x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0) prekk[xx * ksize + x] /= ww;
    bounds.push([xmin, xmax]);
  }
  const kk = new Int32Array(prekk.length);
  for (let i = 0; i < prekk.length; i++) {
    const v = prekk[i];
    kk[i] = v < 0 ? Math.trunc(-0.5 + v * ONE) : Math.trunc(0.5 + v * ONE);
  }
  return { ksize, bounds, kk };
}

function clip8(v: number): number {
  if (v >= ONE * 256) return 255;
  if (v <= 0) return 0;
  return Math.floor(v / ONE);
}

/** Image.resize((w, h), LANCZOS) on an L image (ImagingResampleInner). */
export function resizeLanczos(src: Uint8Array, w: number, h: number, outW: number, outH: number): Uint8Array {
  const horiz = precompute(w, 0, w, outW);
  const vert = precompute(h, 0, h, outH);
  const yFirst = vert.bounds[0][0];
  const yLast = vert.bounds[outH - 1][0] + vert.bounds[outH - 1][1];
  let cur = src;
  let curW = w;
  if (outW !== w) {
    for (const b of vert.bounds) b[0] -= yFirst;
    const th = yLast - yFirst;
    const tmp = new Uint8Array(outW * th);
    for (let yy = 0; yy < th; yy++) {
      const row = (yy + yFirst) * w;
      for (let xx = 0; xx < outW; xx++) {
        const [xmin, xmax] = horiz.bounds[xx];
        const k = xx * horiz.ksize;
        // Exact integer arithmetic: products stay below 2^53.
        let ss = ONE / 2;
        for (let x = 0; x < xmax; x++) ss += src[row + x + xmin] * horiz.kk[k + x];
        tmp[yy * outW + xx] = clip8(ss);
      }
    }
    cur = tmp;
    curW = outW;
  }
  if (outH !== h) {
    const out = new Uint8Array(curW * outH);
    for (let yy = 0; yy < outH; yy++) {
      const [ymin, ymax] = vert.bounds[yy];
      const k = yy * vert.ksize;
      for (let xx = 0; xx < curW; xx++) {
        let ss = ONE / 2;
        for (let y = 0; y < ymax; y++) ss += cur[(y + ymin) * curW + xx] * vert.kk[k + y];
        out[yy * curW + xx] = clip8(ss);
      }
    }
    cur = out;
  }
  return cur;
}

/** scipy.fftpack.dct type II, unnormalized. */
function dct2(input: Float64Array, out: Float64Array) {
  const n = input.length;
  for (let k = 0; k < out.length; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += input[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    out[k] = 2 * s;
  }
}

/** pHash of an 8-bit L image as imagehash's hex string. */
export function phashLuma(l: Uint8Array, w: number, h: number): string {
  const HASH = 8;
  const SIZE = 32;
  const small = resizeLanczos(l, w, h, SIZE, SIZE);
  const cols = new Float64Array(SIZE * SIZE);
  const colIn = new Float64Array(SIZE);
  const colOut = new Float64Array(SIZE);
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) colIn[y] = small[y * SIZE + x];
    dct2(colIn, colOut);
    for (let y = 0; y < SIZE; y++) cols[y * SIZE + x] = colOut[y];
  }
  const low = new Float64Array(HASH * HASH);
  const rowOut = new Float64Array(SIZE);
  for (let y = 0; y < HASH; y++) {
    dct2(cols.subarray(y * SIZE, (y + 1) * SIZE), rowOut);
    for (let x = 0; x < HASH; x++) low[y * HASH + x] = rowOut[x];
  }
  const sorted = Float64Array.from(low).sort();
  const med = (sorted[31] + sorted[32]) / 2;
  let bits = 0n;
  for (const v of low) bits = (bits << 1n) | (v > med ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

/** Pillow RGB -> L: (r*19595 + g*38470 + b*7471 + 0x8000) >> 16. */
function luma(px: Uint8Array, channels: number): Uint8Array {
  const n = px.length / channels;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += channels) out[i] = (px[j] * 19595 + px[j + 1] * 38470 + px[j + 2] * 7471 + 0x8000) >>> 16;
  return out;
}

/** Decode a WebP file (libwebp, as Pillow does) and hash it; undefined when unreadable. */
export async function phashWebpFile(file: string): Promise<string | undefined> {
  try {
    const { data, info } = await sharp(await readFile(file)).raw().toBuffer({ resolveWithObject: true });
    if (info.channels < 3) return phashLuma(new Uint8Array(data), info.width, info.height);
    return phashLuma(luma(new Uint8Array(data), info.channels), info.width, info.height);
  } catch {
    return undefined;
  }
}
