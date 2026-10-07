// Pillow's `Image.resize` for 8-bit images (port of lp_ml::preprocess::pil,
// itself a line-by-line port of libImaging/Resample.c, Pillow 9-12): the same
// coefficient table, the same 22-bit fixed point, horizontal pass first over
// only the rows the vertical pass reads, u8 between the passes. Bit-exact
// with Pillow (checked by scripts/ml_goldens.ts against the preprocess goldens).

export type Filter = "box" | "bilinear" | "hamming" | "bicubic" | "lanczos";

function support(f: Filter): number {
  switch (f) {
    case "box":
      return 0.5;
    case "bilinear":
    case "hamming":
      return 1;
    case "bicubic":
      return 2;
    case "lanczos":
      return 3;
  }
}

function sinc(x: number): number {
  if (x === 0) return 1;
  x *= Math.PI;
  return Math.sin(x) / x;
}

function evalFilter(f: Filter, x: number): number {
  switch (f) {
    case "box":
      return x > -0.5 && x <= 0.5 ? 1 : 0;
    case "bilinear": {
      x = Math.abs(x);
      return x < 1 ? 1 - x : 0;
    }
    case "hamming": {
      x = Math.abs(x);
      if (x === 0) return 1;
      if (x >= 1) return 0;
      x *= Math.PI;
      return (Math.sin(x) / x) * (0.54 + 0.46 * Math.cos(x));
    }
    case "bicubic": {
      const a = -0.5;
      x = Math.abs(x);
      if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
      if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
      return 0;
    }
    case "lanczos":
      return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
  }
}

const PRECISION_BITS = 32 - 8 - 2;
const ONE = 1 << PRECISION_BITS;
const HALF = 1 << (PRECISION_BITS - 1);

interface Coeffs {
  ksize: number;
  /** xmin per output pixel. */
  min: Int32Array;
  /** tap count per output pixel. */
  count: Int32Array;
  /** `ksize` fixed-point weights per output pixel. */
  kk: Int32Array;
}

/** `precompute_coeffs` + `normalize_coeffs_8bpc` for output pixels [from, to). */
function precompute(inSize: number, outSize: number, filter: Filter, from: number, to: number): Coeffs {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const sup = support(filter) * filterscale;
  const ksize = Math.ceil(sup) * 2 + 1;
  const n = to - from;
  const min = new Int32Array(n);
  const count = new Int32Array(n);
  const kk = new Int32Array(n * ksize);
  const k = new Float64Array(ksize);
  const ss = 1 / filterscale;
  for (let i = 0; i < n; i++) {
    const center = (from + i + 0.5) * scale;
    // C's (int) cast truncates toward zero.
    const xmin = Math.max(Math.trunc(center - sup + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + sup + 0.5), inSize);
    const c = Math.max(xmax - xmin, 0);
    let ww = 0;
    for (let x = 0; x < c; x++) {
      const w = evalFilter(filter, (x + xmin - center + 0.5) * ss);
      k[x] = w;
      ww += w;
    }
    for (let x = 0; x < c; x++) {
      const w = ww !== 0 ? k[x] / ww : k[x];
      const f = w * ONE;
      kk[i * ksize + x] = w < 0 ? Math.trunc(-0.5 + f) : Math.trunc(0.5 + f);
    }
    min[i] = xmin;
    count[i] = c;
  }
  return { ksize, min, count, kk };
}

const clip8 = (v: number) => {
  const s = v >> PRECISION_BITS;
  return s < 0 ? 0 : s > 255 ? 255 : s;
};

/**
 * `Image.resize((dstW, dstH), filter).crop((x0, y0, x0 + cw, y0 + ch))` of an
 * interleaved 8-bit image with `channels` channels, without resampling the
 * pixels outside the crop (the same bits as resizing the whole image first).
 */
export function resizeCrop(
  src: Uint8Array,
  w: number,
  h: number,
  channels: number,
  dstW: number,
  dstH: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  filter: Filter,
): Uint8Array {
  if (src.length !== w * h * channels) throw new Error("image buffer size");
  if (x0 + cw > dstW || y0 + ch > dstH) throw new Error("crop outside the output");
  if (cw === 0 || ch === 0) return new Uint8Array(0);
  const needH = dstW !== w;
  const needV = dstH !== h;
  const vert = needV ? precompute(h, dstH, filter, y0, y0 + ch) : null;
  // Source rows the vertical pass reads (the crop rows themselves without one).
  const first = vert ? vert.min[0] : y0;
  const last = vert ? vert.min[ch - 1] + vert.count[ch - 1] : y0 + ch;
  const rows = last - first;
  const rowLen = cw * channels;
  const stride = w * channels;
  const tmp = new Uint8Array(rows * rowLen);
  if (needH) {
    const hz = precompute(w, dstW, filter, x0, x0 + cw);
    for (let yy = 0; yy < rows; yy++) {
      const line = (yy + first) * stride;
      const out = yy * rowLen;
      for (let xx = 0; xx < cw; xx++) {
        const xmin = hz.min[xx];
        const cnt = hz.count[xx];
        const kb = xx * hz.ksize;
        for (let c = 0; c < channels; c++) {
          let ss = HALF;
          let at = line + xmin * channels + c;
          for (let x = 0; x < cnt; x++, at += channels) ss = (ss + src[at] * hz.kk[kb + x]) | 0;
          tmp[out + xx * channels + c] = clip8(ss);
        }
      }
    }
  } else {
    for (let yy = 0; yy < rows; yy++) {
      const at = ((yy + first) * w + x0) * channels;
      tmp.set(src.subarray(at, at + rowLen), yy * rowLen);
    }
  }
  if (!vert) return tmp;
  const out = new Uint8Array(ch * rowLen);
  for (let yy = 0; yy < ch; yy++) {
    const ymin = vert.min[yy] - first;
    const cnt = vert.count[yy];
    const kb = yy * vert.ksize;
    const o = yy * rowLen;
    for (let i = 0; i < rowLen; i++) {
      let ss = HALF;
      let at = ymin * rowLen + i;
      for (let y = 0; y < cnt; y++, at += rowLen) ss = (ss + tmp[at] * vert.kk[kb + y]) | 0;
      out[o + i] = clip8(ss);
    }
  }
  return out;
}

/** `Image.resize((dstW, dstH), filter)` of an interleaved 8-bit image. */
export function resize(src: Uint8Array, w: number, h: number, channels: number, dstW: number, dstH: number, filter: Filter): Uint8Array {
  if (dstW === 0 || dstH === 0) return new Uint8Array(0);
  if (dstW === w && dstH === h) return src.slice();
  return resizeCrop(src, w, h, channels, dstW, dstH, 0, 0, dstW, dstH, filter);
}

/** Python's `round()` (half to even) for non-negative values. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0) return r - Math.sign(x);
  return r;
}

/**
 * The CLIP-family step: shortest edge to `size` with `round()` on the long
 * edge (never below `size`), then the centred `size` x `size` crop with
 * Pillow's `(width - size) // 2` offsets. Only the crop is resampled (a
 * 1-pixel-high panorama would otherwise resize to gigabytes first).
 */
export function resizeShortestEdgeCenterCrop(src: Uint8Array, w: number, h: number, size: number, filter: Filter): Uint8Array {
  const scale = size / Math.min(w, h);
  const nw = Math.max(pyRound(w * scale), size);
  const nh = Math.max(pyRound(h * scale), size);
  const left = Math.floor((nw - size) / 2);
  const top = Math.floor((nh - size) / 2);
  return resizeCrop(src, w, h, 3, nw, nh, left, top, size, size, filter);
}
