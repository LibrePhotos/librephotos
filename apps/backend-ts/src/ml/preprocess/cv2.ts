// OpenCV's 8-bit `cv2.resize` (no antialiasing), as PP-OCR and insightface
// call it (port of lp_ml::preprocess::cv2). INTER_LINEAR follows
// imgproc/src/resize.cpp: 11-bit fixed-point weights, an int horizontal
// pass, and the vectorised vertical pass's rounding
// (`((S0 >> 4) * b0 >> 16) + ((S1 >> 4) * b1 >> 16) + 2 >> 2`). An exact 2x
// downscale is INTER_AREA, as in OpenCV. INTER_AREA follows
// resizeAreaFast_ / resizeArea_. Bit-exact against opencv-python 5.0 on x86.

const f = Math.fround;

/** Rust's `round_ties_even` (cvRound): half to even. */
export function roundTiesEven(x: number): number {
  const fl = Math.floor(x);
  const d = x - fl;
  if (d < 0.5) return fl;
  if (d > 0.5) return fl + 1;
  return fl % 2 === 0 ? fl : fl + 1;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** `cv2.resize(img, (dstW, dstH))` with INTER_LINEAR (the default), interleaved u8. */
export function resizeLinear(src: Uint8Array, w: number, h: number, channels: number, dstW: number, dstH: number): Uint8Array {
  if (src.length !== w * h * channels) throw new Error("image buffer size");
  if (dstW === w && dstH === h) return src.slice();
  if (w === dstW * 2 && h === dstH * 2) return resizeArea(src, w, h, channels, dstW, dstH);
  const SCALE = 1 << 11;
  // OpenCV divides by the inverse scale it was given.
  const scaleX = 1 / (dstW / w);
  const scaleY = 1 / (dstH / h);

  // Columns past an edge take the edge pixel with weight 1; rows keep their
  // fraction and clamp only the row index.
  const tab = (dst: number, srcLen: number, scale: number, clampEdges: boolean) => {
    const s = new Int32Array(dst);
    const a0 = new Int32Array(dst);
    const a1 = new Int32Array(dst);
    for (let d = 0; d < dst; d++) {
      let fv = f((d + 0.5) * scale - 0.5);
      let si = Math.floor(fv);
      fv = f(fv - si);
      if (clampEdges && si < 0) {
        fv = 0;
        si = 0;
      }
      if (clampEdges && si >= srcLen - 1) {
        fv = 0;
        si = srcLen - 1;
      }
      s[d] = si;
      a0[d] = roundTiesEven(f(f(1 - fv) * SCALE));
      a1[d] = roundTiesEven(f(fv * SCALE));
    }
    return { s, a0, a1 };
  };
  const xt = tab(dstW, w, scaleX, true);
  const yt = tab(dstH, h, scaleY, false);
  const row = (y: number) => clamp(y, 0, h - 1);
  const rowLen = dstW * channels;

  const hrow = (y: number, out: Int32Array) => {
    const base = y * w * channels;
    for (let dx = 0; dx < dstW; dx++) {
      const sx = xt.s[dx];
      const nx = Math.min(sx + 1, w - 1);
      const a0 = xt.a0[dx];
      const a1 = xt.a1[dx];
      for (let c = 0; c < channels; c++) {
        out[dx * channels + c] = src[base + sx * channels + c] * a0 + src[base + nx * channels + c] * a1;
      }
    }
  };

  const out = new Uint8Array(rowLen * dstH);
  let k0 = -1;
  let k1 = -1;
  let r0 = new Int32Array(rowLen);
  let r1 = new Int32Array(rowLen);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = yt.s[dy];
    const y0 = row(sy);
    const y1 = row(sy + 1);
    if (y0 !== k0 || y1 !== k1) {
      if (y0 === k1 && y1 !== k1) {
        // the next row pair shares a row with this one
        [r0, r1] = [r1, r0];
        hrow(y1, r1);
      } else {
        hrow(y0, r0);
        hrow(y1, r1);
      }
      k0 = y0;
      k1 = y1;
    }
    const b0 = yt.a0[dy];
    const b1 = yt.a1[dy];
    const o = dy * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const s0 = clamp(r0[i] >> 4, -32768, 32767);
      const s1 = clamp(r1[i] >> 4, -32768, 32767);
      const t = clamp(((s0 * b0) >> 16) + ((s1 * b1) >> 16), -32768, 32767);
      out[o + i] = clamp((t + 2) >> 2, 0, 255);
    }
  }
  return out;
}

/**
 * `cv2.resize(..., interpolation=cv2.INTER_AREA)` for downscaling:
 * resizeAreaFast_ for integer factors (an exact 2x rounds `(sum + 2) >> 2`,
 * others `cvRound(sum * (1.f / n))`) and resizeArea_ otherwise (f32 area
 * weights from computeResizeAreaTab, rows accumulated in f32, cvRound).
 */
export function resizeArea(src: Uint8Array, w: number, h: number, channels: number, dstW: number, dstH: number): Uint8Array {
  if (src.length !== w * h * channels) throw new Error("image buffer size");
  if (dstW === w && dstH === h) return src.slice();
  const scaleX = 1 / (dstW / w);
  const scaleY = 1 / (dstH / h);
  const ix = roundTiesEven(scaleX);
  const iy = roundTiesEven(scaleY);
  if (Math.abs(scaleX - ix) < Number.EPSILON && Math.abs(scaleY - iy) < Number.EPSILON) {
    return areaFast(src, w, channels, dstW, dstH, ix, iy);
  }
  const xt = areaTab(w, dstW, scaleX);
  const yt = areaTab(h, dstH, scaleY);
  const rowLen = dstW * channels;
  const out = new Uint8Array(dstH * rowLen);
  const buf = new Float32Array(rowLen);
  const sum = new Float32Array(rowLen);
  let prev = yt.n > 0 ? yt.d[0] : 0;
  const flush = (dy: number) => {
    const o = dy * rowLen;
    for (let i = 0; i < rowLen; i++) out[o + i] = clamp(roundTiesEven(sum[i]), 0, 255);
  };
  for (let k = 0; k < yt.n; k++) {
    const dy = yt.d[k];
    const sy = yt.s[k];
    const beta = yt.w[k];
    buf.fill(0);
    const base = sy * w * channels;
    for (let j = 0; j < xt.n; j++) {
      const dx = xt.d[j] * channels;
      const sx = base + xt.s[j] * channels;
      const alpha = xt.w[j];
      for (let c = 0; c < channels; c++) buf[dx + c] += f(src[sx + c] * alpha);
    }
    if (dy !== prev) {
      flush(prev);
      for (let i = 0; i < rowLen; i++) sum[i] = beta * buf[i];
      prev = dy;
    } else {
      for (let i = 0; i < rowLen; i++) sum[i] += f(beta * buf[i]);
    }
  }
  flush(prev);
  return out;
}

/** resizeAreaFast_ for integer factors `fx` x `fy`. */
function areaFast(src: Uint8Array, w: number, channels: number, dstW: number, dstH: number, fx: number, fy: number): Uint8Array {
  const scale = f(1 / (fx * fy));
  const out = new Uint8Array(dstW * dstH * channels);
  const two = fx === 2 && fy === 2;
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      for (let c = 0; c < channels; c++) {
        let s = 0;
        for (let y = dy * fy; y < (dy + 1) * fy; y++) {
          for (let x = dx * fx; x < (dx + 1) * fx; x++) s += src[(y * w + x) * channels + c];
        }
        out[(dy * dstW + dx) * channels + c] = two ? (s + 2) >> 2 : clamp(roundTiesEven(f(f(s) * scale)), 0, 255);
      }
    }
  }
  return out;
}

/** computeResizeAreaTab: (dst index, src index, weight) in OpenCV's order. */
function areaTab(ssize: number, dsize: number, scale: number) {
  const d: number[] = [];
  const s: number[] = [];
  const wt: number[] = [];
  const push = (dx: number, sx: number, v: number) => {
    d.push(dx);
    s.push(sx);
    wt.push(f(v));
  };
  for (let dx = 0; dx < dsize; dx++) {
    const fsx1 = dx * scale;
    const fsx2 = fsx1 + scale;
    const cell = Math.min(scale, ssize - fsx1);
    const sx2 = Math.min(Math.floor(fsx2), ssize - 1);
    const sx1 = Math.min(Math.ceil(fsx1), sx2);
    if (sx1 - fsx1 > 1e-3) push(dx, sx1 - 1, (sx1 - fsx1) / cell);
    for (let sx = sx1; sx < sx2; sx++) push(dx, sx, 1 / cell);
    if (fsx2 - sx2 > 1e-3) push(dx, sx2, Math.min(fsx2 - sx2, 1, cell) / cell);
  }
  return { n: d.length, d: Int32Array.from(d), s: Int32Array.from(s), w: Float32Array.from(wt) };
}

/** The face port's name for roundTiesEven. */
export const roundEven = roundTiesEven;
