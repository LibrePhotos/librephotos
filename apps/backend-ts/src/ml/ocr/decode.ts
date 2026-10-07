// `read_image` of service/ocr (port of lp_ml::ocr::ppocr::decode): what
// `cv2.imdecode(buf, IMREAD_UNCHANGED)` + `to_bgr_3channel` make of a file,
// as 8-bit 3-channel pixels (kept in RGB order; the tensors swap to the
// model's BGR). No EXIF orientation (IMREAD_UNCHANGED applies none), alpha
// dropped without compositing, 16-bit samples truncated `v / 257`, grey
// replicated; capped at 40 MP with INTER_AREA. JPEGs decode like Pillow /
// libjpeg-turbo (as librephotos-rs's libvips decoder does).
import { readFile } from "node:fs/promises";
import { loadSharp } from "../../lib/native";
import { decodeBmp, isBmp } from "../preprocess/bmp";
import { resizeArea } from "../preprocess/cv2";
import { decodeRgb } from "../preprocess/index";
import type { Image3 } from "./warp";

/** MAX_INPUT_PIXELS. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** The file is missing, unreadable or not an image (the sidecar's 400). */
export class DecodeError extends Error {}

const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Interleaved samples with `ch` channels as RGB u8 (grey replicated, alpha dropped). */
function toRgb8(src: ArrayLike<number>, n: number, ch: number, conv: (v: number) => number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let p = 0, s = 0, o = 0; p < n; p++, s += ch, o += 3) {
    if (ch <= 2) {
      const g = conv(src[s]);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
    } else {
      out[o] = conv(src[s]);
      out[o + 1] = conv(src[s + 1]);
      out[o + 2] = conv(src[s + 2]);
    }
  }
  return out;
}

/** cmyk -> rgb as the TIFF readers do (Pillow's cmyk2rgb). */
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

/** Everything but JPEG and BMP, through libvips with cv2's sample conversion. */
async function decodeOther(bytes: Uint8Array): Promise<Image3> {
  const sharp = await loadSharp();
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const opts = { ignoreIcc: true, limitInputPixels: false, failOn: "error" } as const;
  const meta = await sharp(input, opts).metadata();
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
    rgb = toRgb8(s, n, ch, (v) => Math.trunc(Math.fround(v / 257)));
  } else if (ch === 3) {
    rgb = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    rgb = toRgb8(data, n, ch, (v) => v);
  }
  return { w: info.width, h: info.height, data: rgb };
}

/** Decode `path` like the sidecar's `read_image`. */
export async function readImage(path: string): Promise<Image3> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (e) {
    throw new DecodeError(`could not read image at ${path}: ${(e as Error).message}`);
  }
  let img: Image3;
  try {
    if (isJpeg(bytes)) {
      const rgb = await decodeRgb(bytes);
      img = { w: rgb.width, h: rgb.height, data: rgb.data };
    } else if (isBmp(bytes)) {
      const rgb = decodeBmp(bytes);
      img = { w: rgb.width, h: rgb.height, data: rgb.data };
    } else {
      img = await decodeOther(bytes);
    }
  } catch (e) {
    throw new DecodeError(`could not decode image at ${path}: ${(e as Error).message}`);
  }
  if (img.w === 0 || img.h === 0) throw new DecodeError(`could not decode image at ${path}`);
  return capPixels(img, MAX_INPUT_PIXELS);
}

/** Scale anything over `maxPixels` down with INTER_AREA. */
export function capPixels(img: Image3, maxPixels: number): Image3 {
  const { w, h } = img;
  if (w * h <= maxPixels) return img;
  const scale = Math.sqrt(maxPixels / (h * w));
  const nw = Math.max(Math.trunc(w * scale), 1);
  const nh = Math.max(Math.trunc(h * scale), 1);
  return { w: nw, h: nh, data: resizeArea(img.data, w, h, 3, nw, nh) };
}
