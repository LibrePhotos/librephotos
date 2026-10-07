// OpenCV's 8-bit `cv2.resize` (no antialiasing), port of lp_ml::preprocess::cv2
// (bit-exact against opencv-python 5.0 on x86). `INTER_LINEAR` follows
// imgproc/src/resize.cpp: 11-bit fixed-point weights, an int horizontal pass
// and the vectorised vertical pass's rounding; an exact 2x downscale is
// `INTER_AREA`, as in OpenCV.

const f32 = Math.fround;

/** Round half to even (cvRound, `round_ties_even`). */
export function roundEven(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const clampI16 = (v: number) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);

/** `cv2.resize(img, (dstW, dstH))` with `INTER_LINEAR` (the default). */
export function resizeLinear(src: Uint8Array, w: number, h: number, channels: number, dstW: number, dstH: number): Uint8Array {
  if (src.length !== w * h * channels) throw new Error("image buffer size");
  if (dstW === w && dstH === h) return src.slice();
  if (w === dstW * 2 && h === dstH * 2) return resizeArea(src, w, h, channels, dstW, dstH);
  const SCALE = 2048;
  // OpenCV divides by the inverse scale it was given.
  const scaleX = 1 / (dstW / w);
  const scaleY = 1 / (dstH / h);

  // Columns past an edge take the edge pixel with weight 1; rows keep their
  // fraction and clamp only the row index.
  const tab = (dst: number, srcLen: number, scale: number, clamp: boolean) => {
    const s = new Int32Array(dst);
    const a0 = new Int32Array(dst);
    const a1 = new Int32Array(dst);
    for (let d = 0; d < dst; d++) {
      let f = f32((d + 0.5) * scale - 0.5);
      let si = Math.floor(f);
      f = f32(f - si);
      if (clamp && si < 0) {
        f = 0;
        si = 0;
      }
      if (clamp && si >= srcLen - 1) {
        f = 0;
        si = srcLen - 1;
      }
      s[d] = si;
      a0[d] = roundEven(f32(f32(1 - f) * SCALE));
      a1[d] = roundEven(f32(f * SCALE));
    }
    return { s, a0, a1 };
  };
  const xt = tab(dstW, w, scaleX, true);
  const yt = tab(dstH, h, scaleY, false);
  const row = (y: number) => (y < 0 ? 0 : y > h - 1 ? h - 1 : y);
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

  const out = new Uint8Array(dstW * dstH * channels);
  let k0 = -1;
  let k1 = -1;
  let r0 = new Int32Array(rowLen);
  let r1 = new Int32Array(rowLen);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = yt.s[dy];
    const y0 = row(sy);
    const y1 = row(sy + 1);
    if (y0 !== k0 || y1 !== k1) {
      if (y0 === k1) {
        // Reuse the row the previous pair already computed.
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
      const s0 = clampI16(r0[i] >> 4);
      const s1 = clampI16(r1[i] >> 4);
      const t = clampI16(((s0 * b0) >> 16) + ((s1 * b1) >> 16));
      const v = (t + 2) >> 2;
      out[o + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/**
 * `cv2.resize(..., interpolation=cv2.INTER_AREA)` for downscaling:
 * `resizeAreaFast_` for integer factors, else `resizeArea_` (f32 weights).
 */
export function resizeArea(src: Uint8Array, w: number, h: number, channels: number, dstW: number, dstH: number): Uint8Array {
  if (src.length !== w * h * channels) throw new Error("image buffer size");
  if (dstW === w && dstH === h) return src.slice();
  const scaleX = 1 / (dstW / w);
  const scaleY = 1 / (dstH / h);
  const ix = roundEven(scaleX);
  const iy = roundEven(scaleY);
  if (Math.abs(scaleX - ix) < Number.EPSILON && Math.abs(scaleY - iy) < Number.EPSILON) {
    return areaFast(src, w, channels, dstW, dstH, ix, iy);
  }
  const xt = areaTab(w, dstW, scaleX);
  const yt = areaTab(h, dstH, scaleY);
  const rowLen = dstW * channels;
  const out = new Uint8Array(dstH * rowLen);
  const buf = new Float32Array(rowLen);
  const sum = new Float32Array(rowLen);
  let prev = yt.length ? yt[0][0] : 0;
  const flush = (dy: number) => {
    for (let i = 0; i < rowLen; i++) {
      const v = roundEven(sum[i]);
      out[dy * rowLen + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  };
  for (const [dy, sy, beta] of yt) {
    buf.fill(0);
    const base = sy * w * channels;
    for (const [dx, sx, alpha] of xt) {
      for (let c = 0; c < channels; c++) {
        const d = dx * channels + c;
        buf[d] = f32(buf[d] + f32(src[base + sx * channels + c] * alpha));
      }
    }
    if (dy !== prev) {
      flush(prev);
      for (let i = 0; i < rowLen; i++) sum[i] = f32(beta * buf[i]);
      prev = dy;
    } else {
      for (let i = 0; i < rowLen; i++) sum[i] = f32(sum[i] + f32(beta * buf[i]));
    }
  }
  flush(prev);
  return out;
}

function areaFast(src: Uint8Array, w: number, channels: number, dstW: number, dstH: number, fx: number, fy: number): Uint8Array {
  const scale = f32(1 / (fx * fy));
  const out = new Uint8Array(dstW * dstH * channels);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let y = dy * fy; y < (dy + 1) * fy; y++) {
          for (let x = dx * fx; x < (dx + 1) * fx; x++) sum += src[(y * w + x) * channels + c];
        }
        let v: number;
        if (fx === 2 && fy === 2) v = (sum + 2) >> 2;
        else v = roundEven(f32(sum * scale));
        out[(dy * dstW + dx) * channels + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

/** `computeResizeAreaTab`: (dst index, src index, f32 weight) in OpenCV's order. */
function areaTab(ssize: number, dsize: number, scale: number): [number, number, number][] {
  const tab: [number, number, number][] = [];
  for (let dx = 0; dx < dsize; dx++) {
    const fsx1 = dx * scale;
    const fsx2 = fsx1 + scale;
    const cell = Math.min(scale, ssize - fsx1);
    const sx2 = Math.min(Math.floor(fsx2), ssize - 1);
    const sx1 = Math.min(Math.ceil(fsx1), sx2);
    if (sx1 - fsx1 > 1e-3) tab.push([dx, sx1 - 1, f32((sx1 - fsx1) / cell)]);
    for (let sx = sx1; sx < sx2; sx++) tab.push([dx, sx, f32(1 / cell)]);
    if (fsx2 - sx2 > 1e-3) tab.push([dx, sx2, f32(Math.min(fsx2 - sx2, 1, cell) / cell)]);
  }
  return tab;
}
