// `np.array(Image.open(src).convert("RGB"))` for the face models: port of
// lp_ml::preprocess::{load_rgb, jpeg_truncated, png_close_tail} on sharp
// (libvips' libjpeg-turbo, like Pillow). EXIF orientation is NOT applied and
// the embedded ICC profile is ignored (Pillow does neither); alpha is
// dropped, grey is replicated. Buffers only (sharp keeps path-opened files
// locked on Windows); sharp itself is loaded on first use.
import { readFile } from "node:fs/promises";

export interface Rgb {
  /** Packed RGB, row-major. */
  data: Uint8Array;
  width: number;
  height: number;
}

/** A JPEG whose entropy-coded data has no EOI after the first scan header (cut off mid-image). */
export function jpegTruncated(b: Uint8Array): boolean {
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  for (;;) {
    while (i + 1 < b.length && b[i] === 0xff && b[i + 1] === 0xff) i++;
    if (i + 4 > b.length) return true;
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

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** A PNG cut inside or before its IEND chunk, closed after the last whole chunk (Pillow stops once the data is complete). */
export function pngCloseTail(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || PNG_SIG.some((v, i) => b[i] !== v)) return null;
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

/** Decode an encoded image like Pillow's `convert("RGB")`. */
export async function decodeRgb(bytes: Uint8Array): Promise<Rgb> {
  if (jpegTruncated(bytes)) throw new Error("image file is truncated");
  // libvips (without ImageMagick) reads no BMP.
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return decodeBmp(bytes);
  const input = pngCloseTail(bytes) ?? bytes;
  const sharp = (await import("sharp")).default;
  const open = () => sharp(input, { ignoreIcc: true, limitInputPixels: false });
  const meta = await open().metadata();
  const sixteen = meta.depth === "ushort";
  if (meta.space === "cmyk") {
    // Pillow's cmyk2rgb on the raw (Adobe-uninverted) CMYK samples, no profile.
    const { data, info } = await open().pipelineColourspace("cmyk").toColourspace("cmyk").raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const out = new Uint8Array(n * 3);
    const mulDiv255 = (a: number, b: number) => {
      const t = a * b + 128;
      return ((t >> 8) + t) >> 8;
    };
    for (let i = 0; i < n; i++) {
      const nk = 255 - data[i * info.channels + 3];
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, nk - mulDiv255(data[i * info.channels + c], nk));
    }
    return { data: out, width: info.width, height: info.height };
  }
  if (sixteen && (meta.channels ?? 3) <= 2) {
    // Pillow opens 16-bit grey as mode I;16, whose RGB conversion clips at 255.
    const { data, info } = await open()
      .pipelineColourspace("grey16")
      .toColourspace("grey16")
      .extractChannel(0)
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    const v = new Uint16Array(data.buffer, data.byteOffset, info.width * info.height);
    const out = new Uint8Array(v.length * 3);
    for (let i = 0; i < v.length; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v[i] > 255 ? 255 : v[i];
    return { data: out, width: info.width, height: info.height };
  }
  if (sixteen) {
    // 16-bit colour: Pillow keeps the high byte of each sample.
    const { data, info } = await open()
      .pipelineColourspace("rgb16")
      .toColourspace("rgb16")
      .removeAlpha()
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    const v = new Uint16Array(data.buffer, data.byteOffset, info.width * info.height * info.channels);
    return { data: expand(Uint8Array.from(v, (x) => x >> 8), info.width, info.height, info.channels), width: info.width, height: info.height };
  }
  const { data, info } = await open().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: expand(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, info.channels), width: info.width, height: info.height };
}

/** Uncompressed BMP (1/4/8-bit palette, 24-bit, 32-bit BI_RGB / BI_BITFIELDS BGRX), what Pillow reads most often. */
export function decodeBmp(b: Uint8Array): Rgb {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 26) throw new Error("cannot identify image file (BMP header)");
  const offset = dv.getUint32(10, true);
  const hdr = dv.getUint32(14, true);
  let width: number;
  let rawHeight: number;
  let bpp: number;
  let compression = 0;
  let colors = 0;
  if (hdr === 12) {
    width = dv.getUint16(18, true);
    rawHeight = dv.getInt16(20, true);
    bpp = dv.getUint16(24, true);
  } else {
    width = dv.getInt32(18, true);
    rawHeight = dv.getInt32(22, true);
    bpp = dv.getUint16(28, true);
    compression = dv.getUint32(30, true);
    colors = dv.getUint32(46, true);
  }
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0) throw new Error("cannot identify image file (BMP size)");
  if (!(compression === 0 || (compression === 3 && bpp === 32))) throw new Error(`Unsupported BMP compression (${compression})`);
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (offset + stride * height > b.length) throw new Error("image file is truncated");
  const palette: number[][] = [];
  if (bpp <= 8) {
    const entry = hdr === 12 ? 3 : 4;
    const n = colors || 1 << bpp;
    for (let i = 0; i < n; i++) {
      const o = 14 + hdr + i * entry;
      palette.push([b[o + 2], b[o + 1], b[o]]);
    }
  }
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (bpp === 24 || bpp === 32) {
        const p = row + x * (bpp / 8);
        out[o] = b[p + 2];
        out[o + 1] = b[p + 1];
        out[o + 2] = b[p];
      } else if (bpp <= 8) {
        const bit = x * bpp;
        const idx = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = palette[idx] ?? [0, 0, 0];
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
      } else throw new Error(`Unsupported BMP pixel depth (${bpp})`);
    }
  }
  return { data: out, width, height };
}

/** n-channel pixels to packed RGB (grey replicated). */
function expand(px: Uint8Array, w: number, h: number, channels: number): Uint8Array {
  if (channels === 3) return px;
  const n = w * h;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = px[i * channels];
    if (channels >= 3) {
      out[i * 3] = g;
      out[i * 3 + 1] = px[i * channels + 1];
      out[i * 3 + 2] = px[i * channels + 2];
    } else out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = g;
  }
  return out;
}

/** `load_rgb(path)`. */
export async function loadRgb(file: string): Promise<Rgb> {
  return decodeRgb(await readFile(file));
}
