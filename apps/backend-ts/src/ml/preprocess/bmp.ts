// Windows BMP decoding for the ML loaders: sharp's libvips has no BMP
// loader, Pillow (the reference) reads it. Uncompressed 1/4/8-bit palette,
// 16/24/32-bit, BI_BITFIELDS; RLE is refused. Like Pillow's convert("RGB"),
// alpha is dropped.
import type { Rgb } from "./index";

export const isBmp = (b: Uint8Array) => b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d;

export function decodeBmp(b: Uint8Array): Rgb {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const offset = dv.getUint32(10, true);
  const hsize = dv.getUint32(14, true);
  let width: number, height: number, bpp: number, compression = 0, colors = 0;
  if (hsize === 12) {
    width = dv.getUint16(18, true);
    height = dv.getInt16(20, true);
    bpp = dv.getUint16(24, true);
  } else {
    if (b.length < 14 + Math.min(hsize, 40)) throw new Error("truncated BMP header");
    width = dv.getInt32(18, true);
    height = dv.getInt32(22, true);
    bpp = dv.getUint16(28, true);
    compression = dv.getUint32(30, true);
    colors = dv.getUint32(46, true);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height === 0) throw new Error("bad BMP size");
  let masks: [number, number, number] | null = null;
  if (compression === 3 || compression === 6) {
    // BI_BITFIELDS: masks after a 40-byte header, else inside the V4/V5 header.
    masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true)];
  } else if (compression !== 0) throw new Error(`unsupported BMP compression ${compression}`);
  if (bpp === 16 && !masks) masks = [0x7c00, 0x03e0, 0x001f];
  if (bpp === 32 && !masks) masks = [0xff0000, 0xff00, 0xff];
  let palette: Uint8Array | null = null;
  if (bpp <= 8) {
    const n = colors || 1 << bpp;
    const entry = hsize === 12 ? 3 : 4;
    const at = 14 + hsize;
    palette = new Uint8Array(256 * 3);
    for (let i = 0; i < n && at + i * entry + 2 < b.length; i++) {
      palette[i * 3] = b[at + i * entry + 2];
      palette[i * 3 + 1] = b[at + i * entry + 1];
      palette[i * 3 + 2] = b[at + i * entry];
    }
  } else if (![16, 24, 32].includes(bpp)) throw new Error(`unsupported BMP depth ${bpp}`);
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (offset + stride * height > b.length) throw new Error("image file is truncated");
  const out = new Uint8Array(width * height * 3);
  const channel = (v: number, mask: number) => {
    if (!mask) return 0;
    const shift = 31 - Math.clz32(mask & -mask);
    const bits = 32 - Math.clz32(mask >>> shift);
    const x = (v & mask) >>> shift;
    return bits >= 8 ? x >>> (bits - 8) : Math.round((x * 255) / ((1 << bits) - 1));
  };
  for (let y = 0; y < height; y++) {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (palette) {
        const bit = x * bpp;
        const idx = (b[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
      } else if (bpp === 24) {
        const p = row + x * 3;
        out[o] = b[p + 2];
        out[o + 1] = b[p + 1];
        out[o + 2] = b[p];
      } else {
        const v = bpp === 16 ? dv.getUint16(row + x * 2, true) : dv.getUint32(row + x * 4, true);
        out[o] = channel(v, masks![0]);
        out[o + 1] = channel(v, masks![1]);
        out[o + 2] = channel(v, masks![2]);
      }
    }
  }
  return { data: out, width, height };
}
