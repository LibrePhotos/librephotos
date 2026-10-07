// PP-OCRv6 (port of lp_ml::ocr::ppocr, i.e. service/ocr/ppocr): DBNet
// detection, DB postprocess, perspective crops, CRNN recognition with CTC
// greedy decoding, reading order. The cv2 / pyclipper pieces are ported
// from their sources so boxes and crops match the sidecar bit for bit
// (scripts/ml_goldens_ocr.ts checks them against the goldens).
import { resizeLinear } from "../preprocess/cv2";
import { loadOrt, session, type Ort } from "../runtime";
import { decodeCharset, loadConfig, type OcrConfig } from "./config";
import { findContours } from "./contours";
import { getMiniBoxes, type Quad } from "./hull";
import { boxScoreFast, orderPointsClockwise, polygonArea, rescaleQuad, unclip, type IntQuad } from "./poly";
import { rotateCrop, type Image3 } from "./warp";
import path from "node:path";

/** minAreaRect boxes with a shorter side below this are discarded. */
export const MIN_BOX_SIDE = 3;
/** A block needs at least this many characters (after strip). */
export const MIN_BLOCK_CHARS = 2;
export const DEFAULT_MIN_CONFIDENCE = 0.6;
export const REC_BATCH_SIZE = 8;

const f = Math.fround;

export interface Options {
  minConfidence: number;
  /** Detection input cap (`max_side`); null = the bundle's. */
  maxSide: number | null;
  /** Detection only: no recognition, only the area signal. */
  detOnly: boolean;
}

export const defaultOptions = (): Options => ({ minConfidence: DEFAULT_MIN_CONFIDENCE, maxSide: null, detOnly: false });

/** Numpy's pairwise summation (`np.add.reduce` over float64). */
export function npSum(a: ArrayLike<number>, lo = 0, hi = a.length): number {
  const n = hi - lo;
  if (n < 8) {
    let r = 0;
    for (let i = lo; i < hi; i++) r += a[i];
    return r;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    const end = n - (n % 8);
    for (; i < end; i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return npSum(a, lo, lo + n2) + npSum(a, lo + n2, hi);
}

export const npMean = (a: ArrayLike<number>) => npSum(a) / a.length;

/** `round_up_to_multiple`. */
export function roundUpToMultiple(value: number, multiple: number): number {
  const v = Math.max(value, 1);
  const n = Math.floor((v + multiple - 1) / multiple);
  return Math.max(n * multiple, multiple);
}

const rte = (x: number) => {
  const fl = Math.floor(x);
  const d = x - fl;
  return d < 0.5 ? fl : d > 0.5 ? fl + 1 : fl % 2 === 0 ? fl : fl + 1;
};

/** `compute_resize`: [width, height] of the detection input. */
export function computeResize(h: number, w: number, maxSide: number, multiple: number): [number, number] {
  const longest = Math.max(h, w);
  const ratio = longest > maxSide ? maxSide / longest : 1;
  return [roundUpToMultiple(rte(w * ratio), multiple), roundUpToMultiple(rte(h * ratio), multiple)];
}

/** `quad_from_contour`: one contour through the DB reject gates. */
export function quadFromContour(contour: number[], prob: Float32Array, w: number, h: number, cfg: OcrConfig): Quad | null {
  const [points, sside] = getMiniBoxes({ int: true, xy: contour });
  if (sside < MIN_BOX_SIDE) return null;
  if (boxScoreFast(prob, w, h, points) < cfg.detBoxThresh) return null;
  const expanded = unclip(points, cfg.detUnclipRatio);
  if (!expanded || expanded.length < 4) return null;
  const xy: number[] = [];
  for (const p of expanded) xy.push(f(p[0]), f(p[1]));
  const [quad, s2] = getMiniBoxes({ int: false, xy });
  if (s2 < MIN_BOX_SIDE + 2) return null;
  return orderPointsClockwise(quad);
}

/** `boxes_from_bitmap`: probability map -> quads in `dest` coordinates. */
export function boxesFromBitmap(prob: Float32Array, w: number, h: number, cfg: OcrConfig, dest: [number, number]): IntQuad[] {
  const bitmap = new Uint8Array(w * h);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = prob[i] > cfg.detThresh ? 1 : 0;
  const contours = findContours(bitmap, w, h);
  const n = Math.min(contours.length, cfg.detMaxCandidates);
  const out: IntQuad[] = [];
  for (let i = 0; i < n; i++) {
    const q = quadFromContour(contours[i], prob, w, h, cfg);
    if (q) out.push(rescaleQuad(q, [w, h], dest));
  }
  return out;
}

/**
 * `(pixel * scale - mean) / std` per channel, CHW, all in f32 in numpy's
 * order of operations; `bgr` reads the RGB pixels in cv2's BGR order.
 * `mean`/`std` are in the output channel order.
 */
export function toChw(
  pixels: Uint8Array,
  w: number,
  h: number,
  bgr: boolean,
  scale: (x: number) => number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const plane = w * h;
  if (pixels.length !== plane * 3) throw new Error("RGB buffer size");
  const out = new Float32Array(3 * plane);
  const lut = new Float32Array(256);
  for (let c = 0; c < 3; c++) {
    const src = bgr ? 2 - c : c;
    const m = f(mean[c]);
    const s = f(std[c]);
    for (let v = 0; v < 256; v++) lut[v] = f(scale(v) - m) / s;
    const base = c * plane;
    for (let i = 0; i < plane; i++) out[base + i] = lut[pixels[i * 3 + src]];
  }
  return out;
}

const div255 = (x: number) => f(x / 255);

/**
 * `resize_norm_img`: aspect-kept resize to the recognizer height, [-1, 1] in
 * BGR, zero-padded to its width. CHW f32.
 */
export function resizeNormImg(img: Image3, shape: [number, number, number]): Float32Array {
  const [c, ih, iw] = shape;
  const ratio = img.w / Math.max(img.h, 1);
  const want = Math.ceil(ih * ratio);
  const rw = want > iw ? iw : Math.max(Math.trunc(want), 1);
  const resized = resizeLinear(img.data, img.w, img.h, 3, rw, ih);
  const t = toChw(resized, rw, ih, true, div255, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  const out = new Float32Array(c * ih * iw);
  for (let ch = 0; ch < Math.min(c, 3); ch++) {
    for (let y = 0; y < ih; y++) {
      out.set(t.subarray(ch * ih * rw + y * rw, ch * ih * rw + (y + 1) * rw), ch * ih * iw + y * iw);
    }
  }
  return out;
}

/** `ctc_greedy_decode` of one (T, C) sequence starting at `off`. */
export function ctcGreedyDecode(probs: Float32Array, off: number, t: number, classes: number, charset: string[]): [string, number] {
  let text = "";
  const confs: number[] = [];
  let previous = -1;
  for (let step = 0; step < t; step++) {
    const base = off + step * classes;
    let best = 0;
    let bv = probs[base];
    for (let i = 1; i < classes; i++) {
      const v = probs[base + i];
      if (v > bv) {
        bv = v;
        best = i;
      }
    }
    if (best === 0) {
      previous = 0;
      continue;
    }
    if (best === previous) continue;
    previous = best;
    const ch = charset[best];
    if (ch !== undefined) {
      text += ch;
      confs.push(bv);
    }
  }
  return [text, confs.length ? npMean(confs) : 0];
}

/** Sum of the detected quads' areas over the image area, at most 1. */
export function textAreaFraction(boxes: IntQuad[], h: number, w: number): number {
  const area = h * w;
  if (area <= 0) return 0;
  let total = 0;
  for (const b of boxes) total += polygonArea(b);
  return Math.min(total / area, 1);
}

/** One recognised block. */
export interface Block {
  text: string;
  quad: IntQuad;
  confidence: number;
}

export const blockJson = (b: Block) => ({ text: b.text, box: b.quad.map((p) => [p[0], p[1]]), confidence: b.confidence });

// Rust's str::trim: Unicode White_Space at both ends.
const WS = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");

/** `build_blocks`: confident blocks with at least two characters. */
export function buildBlocks(boxes: IntQuad[], recognized: [string, number][], minConfidence: number): Block[] {
  const out: Block[] = [];
  const n = Math.min(boxes.length, recognized.length);
  for (let i = 0; i < n; i++) {
    const [text, conf] = recognized[i];
    const stripped = text.replace(TRIM, "");
    if (conf < minConfidence || [...stripped].length < MIN_BLOCK_CHARS) continue;
    out.push({ text: stripped, quad: boxes[i], confidence: conf });
  }
  return out;
}

export const meanConfidence = (blocks: Block[]) => (blocks.length ? npMean(blocks.map((b) => b.confidence)) : 0);

/** `np.median`. */
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * `reading_order_sort`: rows top to bottom (a block joins the first row
 * whose running centre is within half the median block height), blocks
 * left to right within a row.
 */
export function readingOrderSort(blocks: Block[]): Block[] {
  if (!blocks.length) return blocks;
  const heights: number[] = [];
  const items = blocks.map((block) => {
    const ys = block.quad.map((p) => p[1]);
    const xs = block.quad.map((p) => p[0]);
    heights.push(Math.max(...ys) - Math.min(...ys));
    return { block, cy: npMean(ys), left: Math.min(...xs) };
  });
  const tolerance = Math.max(median(heights) * 0.5, 1);
  items.sort((a, b) => a.cy - b.cy);
  const rows: { cy: number; items: typeof items }[] = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(item.cy - r.cy) <= tolerance);
    if (row) {
      row.items.push(item);
      row.cy = npMean(row.items.map((i) => i.cy));
    } else {
      rows.push({ cy: item.cy, items: [item] });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);
  const out: Block[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.left - b.left);
    for (const i of row.items) out.push(i.block);
  }
  return out;
}

/** What `predict` found. `blocks` is empty in det-only mode. */
export interface Prediction {
  text: string;
  blocks: Block[];
  textAreaFraction: number;
  meanConfidence: number;
  boxCount: number;
  imageWidth: number;
  imageHeight: number;
  detOnly: boolean;
}

/** The sidecar's JSON answer. */
export function predictionJson(p: Prediction): Record<string, unknown> {
  if (p.detOnly) {
    return { text_area_fraction: p.textAreaFraction, box_count: p.boxCount, image_width: p.imageWidth, image_height: p.imageHeight };
  }
  return {
    text: p.text,
    blocks: p.blocks.map(blockJson),
    text_area_fraction: p.textAreaFraction,
    mean_confidence: p.meanConfidence,
    image_width: p.imageWidth,
    image_height: p.imageHeight,
  };
}

/** A detection input tensor (CHW, `nw` x `nh`). */
export interface DetInput {
  x: Float32Array;
  nw: number;
  nh: number;
}

/** The detector's input: resize to the bundle's multiple, normalise in its channel order. */
export function detInput(img: Image3, cfg: OcrConfig, maxSide: number): DetInput {
  const [nw, nh] = computeResize(img.h, img.w, maxSide, cfg.detSizeMultiple);
  const resized = resizeLinear(img.data, img.w, img.h, 3, nw, nh);
  const scale = cfg.detScale;
  return { x: toChw(resized, nw, nh, !cfg.detRgb, (v) => f(v * scale), cfg.detMean, cfg.detStd), nw, nh };
}

/** One recognizer batch: the crops' indices and their stacked tensors. */
export interface RecBatch {
  idx: number[];
  data: Float32Array;
}

/** The recognizer's batches: crops sorted by aspect ratio, REC_BATCH_SIZE at a time. */
export function recBatches(crops: Image3[], cfg: OcrConfig): RecBatch[] {
  const n = crops.length;
  const aspect = (i: number) => crops[i].w / Math.max(crops[i].h, 1);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => aspect(a) - aspect(b));
  const shape = cfg.recInputShape;
  const per = shape[0] * shape[1] * shape[2];
  const out: RecBatch[] = [];
  for (let s = 0; s < n; s += REC_BATCH_SIZE) {
    const idx = order.slice(s, s + REC_BATCH_SIZE);
    const data = new Float32Array(idx.length * per);
    idx.forEach((i, j) => data.set(resizeNormImg(crops[i], shape), j * per));
    out.push({ idx, data });
  }
  return out;
}

/** The answer from the boxes and (unless det-only) their recognition: filtering and reading order. */
export function assemble(img: Image3, boxes: IntQuad[], recognized: [string, number][] | null, opts: Options): Prediction {
  const pred: Prediction = {
    text: "",
    blocks: [],
    textAreaFraction: textAreaFraction(boxes, img.h, img.w),
    meanConfidence: 0,
    boxCount: boxes.length,
    imageWidth: img.w,
    imageHeight: img.h,
    detOnly: opts.detOnly,
  };
  if (opts.detOnly || !recognized) return pred;
  const blocks = readingOrderSort(buildBlocks(boxes, recognized, opts.minConfidence));
  pred.text = blocks.map((b) => b.text).join("\n");
  pred.meanConfidence = meanConfidence(blocks);
  pred.blocks = blocks;
  return pred;
}

/** A loaded bundle: config, both sessions and the decode table. */
export class Engine {
  private constructor(
    readonly config: OcrConfig,
    private ort: typeof Ort,
    private det: Ort.InferenceSession,
    private rec: Ort.InferenceSession,
    readonly classes: number,
    private decode: string[],
  ) {}

  /** Load a bundle and validate its charset against the recognizer. */
  static async load(dir: string): Promise<Engine> {
    const config = loadConfig(dir);
    const ort = await loadOrt();
    const det = await session(path.join(dir, "det.onnx"));
    let rec: Ort.InferenceSession | null = null;
    try {
      rec = await session(path.join(dir, "rec.onnx"));
      const meta = rec.outputMetadata[0];
      const last = meta?.isTensor ? meta.shape[meta.shape.length - 1] : undefined;
      if (typeof last !== "number" || last <= 0) throw new Error("recognition model output has no fixed class dimension");
      return new Engine(config, ort, det, rec, last, decodeCharset(config, last));
    } catch (e) {
      await det.release();
      await rec?.release();
      throw e;
    }
  }

  async release() {
    await this.det.release();
    await this.rec.release();
  }

  /** The detector's probability map [map, width, height] for a prepared input. */
  async runDet(d: DetInput): Promise<[Float32Array, number, number]> {
    const input = new this.ort.Tensor("float32", d.x, [1, 3, d.nh, d.nw]);
    const out = await this.det.run({ [this.det.inputNames[0]]: input });
    const t = out[this.det.outputNames[0]];
    if (t.dims.length !== 4) throw new Error(`unexpected detection output shape ${JSON.stringify(t.dims)}`);
    const ph = t.dims[2];
    const pw = t.dims[3];
    const prob = (t.data as Float32Array).slice(0, ph * pw);
    t.dispose();
    return [prob, pw, ph];
  }

  /** The detector's probability map [map, width, height]. */
  probMap(img: Image3, maxSide: number): Promise<[Float32Array, number, number]> {
    return this.runDet(detInput(img, this.config, maxSide));
  }

  /** `detect`: quads in `img` coordinates plus the detection input size. */
  async detect(img: Image3, maxSide: number): Promise<[IntQuad[], [number, number]]> {
    const [prob, pw, ph] = await this.probMap(img, maxSide);
    const size = computeResize(img.h, img.w, maxSide, this.config.detSizeMultiple);
    return [boxesFromBitmap(prob, pw, ph, this.config, [img.w, img.h]), size];
  }

  /** The recognizer over prepared batches: [text, confidence] per crop, in input order. */
  async runRec(batches: RecBatch[], n: number): Promise<[string, number][]> {
    const results: [string, number][] = Array.from({ length: n }, () => ["", 0]);
    const [c, h, w] = this.config.recInputShape;
    for (const b of batches) {
      const input = new this.ort.Tensor("float32", b.data, [b.idx.length, c, h, w]);
      const out = await this.rec.run({ [this.rec.inputNames[0]]: input });
      const o = out[this.rec.outputNames[0]];
      if (o.dims.length !== 3) throw new Error(`unexpected recognition output shape ${JSON.stringify(o.dims)}`);
      const t = o.dims[1];
      const classes = o.dims[2];
      const probs = o.data as Float32Array;
      b.idx.forEach((orig, j) => {
        results[orig] = ctcGreedyDecode(probs, j * t * classes, t, classes, this.decode);
      });
      o.dispose();
    }
    return results;
  }

  /** `Recognizer.recognize`: [text, confidence] per crop, in input order, batched by aspect ratio. */
  recognize(crops: Image3[]): Promise<[string, number][]> {
    return this.runRec(recBatches(crops, this.config), crops.length);
  }

  /** The whole pipeline on a decoded image. */
  async predictImage(img: Image3, opts: Options): Promise<Prediction> {
    const maxSide = opts.maxSide ?? this.config.detMaxSide;
    const [boxes] = await this.detect(img, maxSide);
    return this.finish(img, boxes, opts);
  }

  /** Everything after detection: area signal, crops, recognition, filtering and reading order. */
  async finish(img: Image3, boxes: IntQuad[], opts: Options): Promise<Prediction> {
    if (opts.detOnly) return assemble(img, boxes, null, opts);
    const crops = boxes.map((q) => rotateCrop(img, q));
    return assemble(img, boxes, await this.recognize(crops), opts);
  }
}
