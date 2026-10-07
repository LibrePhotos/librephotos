// Shared ML preprocessing (port of lp_ml::preprocess): decoding like
// Pillow's `Image.open(path).convert("RGB")` through sharp (libvips +
// libjpeg-turbo), NCHW float tensors, and the f32 norm numpy computes.
import { readFile } from "node:fs/promises";

import { decodeBmp, isBmp } from "./bmp";

export * from "./pil";

/** Pillow's cmyk2rgb: `nk - MULDIV255(c, nk)` per channel, nk = 255 - k. */
function cmykToRgb(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const nk = 255 - src[p * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const t = src[p * 4 + c] * nk + 128;
      out[p * 3 + c] = Math.max(0, nk - (((t >> 8) + t) >> 8));
    }
  }
  return out;
}

/** An 8-bit RGB image, rows top to bottom, interleaved. */
export interface Rgb {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * A JPEG whose entropy-coded data has no EOI after the first scan header,
 * i.e. a file cut off mid-image (Pillow: "image file is truncated").
 */
export function jpegTruncated(b: Uint8Array): boolean {
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  for (;;) {
    while (i + 1 < b.length && b[i] === 0xff && b[i + 1] === 0xff) i++;
    if (i + 4 > b.length) return true;
    // Not a marker: leave the verdict to the decoder.
    if (b[i] !== 0xff) return false;
    const marker = b[i + 1];
    if (marker === 0xd9) return false;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) {
      for (let j = i + 2 + len; j + 1 < b.length; j++) if (b[j] === 0xff && b[j + 1] === 0xd9) return false;
      return true;
    }
    i += 2 + len;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/**
 * A PNG cut inside or before its `IEND` chunk, closed with a fresh `IEND`
 * after the last whole chunk (Pillow stops reading once the image data is
 * complete); null for anything else.
 */
export function pngCloseTail(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return null;
  let i = 8;
  while (i + 12 <= b.length) {
    if (b[i + 4] === 0x49 && b[i + 5] === 0x45 && b[i + 6] === 0x4e && b[i + 7] === 0x44) return null;
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const end = i + 12 + len;
    if (end > b.length) break;
    i = end;
  }
  const out = new Uint8Array(i + IEND.length);
  out.set(b.subarray(0, i));
  out.set(IEND, i);
  return out;
}

/** Interleaved samples with `channels` channels as RGB (grey replicated, alpha dropped). */
function toRgb(src: ArrayLike<number>, n: number, channels: number, conv: (v: number, c: number) => number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let p = 0, s = 0, o = 0; p < n; p++, s += channels, o += 3) {
    if (channels <= 2) {
      const g = conv(src[s], 0);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
    } else {
      out[o] = conv(src[s], 0);
      out[o + 1] = conv(src[s + 1], 1);
      out[o + 2] = conv(src[s + 2], 2);
    }
  }
  return out;
}

/**
 * `Image.open(path).convert("RGB")` of the file bytes: no EXIF orientation
 * (Pillow does not apply it either), no ICC transform, alpha dropped, grey
 * replicated, the first frame. Damaged files fail as in Pillow (a JPEG cut
 * short is refused, a PNG cut in `IEND` opens); 16-bit images convert as
 * Pillow does (colour keeps the high byte, 16-bit grey `I;16` clips at 255).
 */
export async function decodeRgb(bytes: Uint8Array): Promise<Rgb> {
  if (jpegTruncated(bytes)) throw new Error("image file is truncated");
  if (isBmp(bytes)) return decodeBmp(bytes);
  const input = Buffer.from(pngCloseTail(bytes) ?? bytes);
  // Imported on first use (the server bundle evaluates every route module at boot).
  const sharp = (await import("sharp")).default;
  const opts = { ignoreIcc: true, limitInputPixels: false, failOn: "error" } as const;
  const meta = await sharp(input, opts).metadata();
  // Keep the file's own samples: no CMYK or 16-bit colour conversion by
  // libvips (Pillow does its own, below).
  let img = sharp(input, opts);
  if (meta.space === "cmyk") img = img.pipelineColourspace("cmyk").toColourspace("cmyk");
  const sixteen = meta.depth === "ushort";
  if (sixteen && (meta.space === "rgb16" || meta.space === "grey16")) img = img.toColourspace(meta.space);
  const { data, info } = await img.raw(sixteen ? { depth: "ushort" } : {}).toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const ch = info.channels;
  let rgb: Uint8Array;
  if (meta.space === "cmyk" && ch === 4) {
    rgb = cmykToRgb(data, n);
  } else if (sixteen) {
    const s = new Uint16Array(data.buffer, data.byteOffset, data.byteLength >> 1);
    rgb = toRgb(s, n, ch, ch === 1 ? (v) => Math.min(v, 255) : (v) => v >> 8);
  } else if (ch === 3) {
    rgb = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    rgb = toRgb(data, n, ch, (v) => v);
  }
  return { data: rgb, width: info.width, height: info.height };
}

/** {@link decodeRgb} of a file (read into memory: sharp must not hold the path open on Windows). */
export async function loadRgb(path: string): Promise<Rgb> {
  return decodeRgb(await readFile(path));
}

/** CLIP / OpenAI normalisation constants (the Python literals). */
export const CLIP_MEAN: [number, number, number] = [0.48145466, 0.4578275, 0.40821073];
export const CLIP_STD: [number, number, number] = [0.26862954, 0.26130258, 0.27577711];

const f = Math.fround;

/**
 * `(pixel / 255 - mean) / std` per channel, CHW, every step rounded to f32
 * as numpy's float32 code does (`arr / 255.0` then `(arr - MEAN) / STD`).
 */
export function toChw(pixels: Uint8Array, w: number, h: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const plane = w * h;
  if (pixels.length !== plane * 3) throw new Error("RGB buffer size");
  const out = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) {
    const m = f(mean[c]);
    const s = f(std[c]);
    // 256 possible inputs per channel: a lookup table of the exact f32 results.
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = f(f(v / 255) - m) / s;
    const base = c * plane;
    for (let i = 0; i < plane; i++) out[base + i] = lut[pixels[i * 3 + c]];
  }
  return out;
}

/** L2 norm accumulated in f32, as `float(np.linalg.norm(e))` of float32 data (sequential sum). */
export function l2Norm(v: ArrayLike<number>): number {
  let acc = 0;
  for (let i = 0; i < v.length; i++) acc = f(acc + f(v[i] * v[i]));
  return f(Math.sqrt(acc));
}

/** `np.stack` of equally sized CHW tensors into one NCHW buffer. */
export function stack(items: Float32Array[], per: number): Float32Array {
  const out = new Float32Array(items.length * per);
  items.forEach((t, i) => {
    if (t.length !== per) throw new Error("tensor size");
    out.set(t, i * per);
  });
  return out;
}
