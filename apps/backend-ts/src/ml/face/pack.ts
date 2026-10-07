// One insightface face pack in process: FaceAnalysis(allowed_modules=
// ["detection", "recognition"]) with det_size=(640, 640), i.e. SCRFD
// detection, Umeyama alignment and ArcFace. Port of lp_ml::face::inprocess
// (FacePack, ArcFace, the box helpers).
//
// The sidecar hands `np.array(Image.open(src).convert("RGB"))` to
// insightface, whose API expects BGR: both networks see the channels swapped.
// That is reproduced on purpose, so new embeddings keep matching the stored
// ones. Embeddings are not normalised.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { FaceBox } from "../../features/tasks/sidecars";
import { loadOrt, session, type InferenceSession } from "../runtime";
import { estimateNorm, warpAffine } from "./align";
import type { Rgb } from "./image";
import { inputDim, readModelInfo, type ModelInfo } from "./onnx_meta";
import { blobBgrSwapped, Scrfd, type Detection } from "./scrfd";

export const DEFAULT_MODEL = "buffalo_sc";
export const SUPPORTED_MODELS = ["antelopev2", "buffalo_l", "buffalo_m", "buffalo_s", "buffalo_sc"];
export const DET_SIZE = 640;
/** `MIN_FACE_MATCH_IOU`. */
export const MIN_FACE_MATCH_IOU = 0.3;
/** LP_FACE_DET_SIZE=auto: a face this small (shorter side, pixels of the 320 input) triggers the 640 pass. */
export const AUTO_SMALL_FACE = 24;

/** `_normalize_model_name`: unknown names fall back to buffalo_sc. */
export const normalizeModelName = (name: string) => (SUPPORTED_MODELS.includes(name) ? name : DEFAULT_MODEL);

/** LP_FACE_DET_SIZE: a fixed detector side (multiple of 32, >= 160; 640 default) or "auto" (320, redo at 640 for small faces). */
export type DetSize = number | "auto";

export function parseDetSize(v: string): DetSize | null {
  const t = v.trim();
  if (!t) return DET_SIZE;
  if (t === "auto") return "auto";
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 160 && n % 32 === 0 ? n : null;
}

function detSizeFromEnv(): DetSize {
  const v = process.env.LP_FACE_DET_SIZE ?? "";
  const d = parseDetSize(v);
  if (d === null) {
    console.warn(`LP_FACE_DET_SIZE=${v}: expected 640, 480, 320 or auto; using 640`);
    return DET_SIZE;
  }
  return d;
}

/** `_to_face_location`: `int(round())` of the float box, as (top, right, bottom, left). */
export function toFaceLocation(b: Detection["bbox"]): FaceBox {
  const r = (v: number) => {
    const x = Math.round(v);
    return x - v === 0.5 && x % 2 !== 0 ? x - 1 : x;
  };
  return [r(b[1]), r(b[2]), r(b[3]), r(b[0])];
}

/** `_iou` of two (top, right, bottom, left) boxes. */
export function iou(a: FaceBox, b: FaceBox): number {
  const top = Math.max(a[0], b[0]);
  const right = Math.min(a[1], b[1]);
  const bottom = Math.min(a[2], b[2]);
  const left = Math.max(a[3], b[3]);
  const inter = Math.max(right - left, 0) * Math.max(bottom - top, 0);
  if (inter === 0) return 0;
  const area = (x: FaceBox) => (x[1] - x[3]) * (x[2] - x[0]);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * `_find_best_face_match`: for each requested box in order, the index of the
 * not yet taken detected face with the highest IoU (>= 0.3; ties go to the
 * later face, as the sidecar's `>=` does), else null.
 */
export function bestFaceMatches(requested: FaceBox[], detected: FaceBox[]): (number | null)[] {
  let remaining = detected.map((_, i) => i);
  return requested.map((loc) => {
    let best: number | null = null;
    let bestScore = MIN_FACE_MATCH_IOU;
    for (const i of remaining) {
      const score = iou(loc, detected[i]);
      if (score >= bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best !== null) remaining = remaining.filter((r) => r !== best);
    return best;
  });
}

/** `ArcFaceONNX`. */
export class ArcFace {
  readonly size: number;
  private mean: number;
  private std: number;

  constructor(
    readonly session: InferenceSession,
    info: ModelInfo,
  ) {
    // An MXNet export normalises inside the graph (Sub + Mul up front).
    const head = info.firstNodes;
    const sub = head.some((n) => n.startsWith("Sub") || n.startsWith("_minus"));
    const mul = head.some((n) => n.startsWith("Mul") || n.startsWith("_mul"));
    [this.mean, this.std] = sub && mul ? [0, 1] : [127.5, 127.5];
    const size = inputDim(info, 3);
    if (size === null || size <= 0) throw new Error("recognition model has no fixed input size");
    this.size = size;
    if (session.outputNames.length !== 1) throw new Error("recognition model must have one output");
  }

  /** `get_feat` of aligned crops (RGB, fed as BGR) in one run (the batch axis is dynamic). */
  async embedMany(crops: Uint8Array[]): Promise<Float32Array[]> {
    const n = crops.length;
    if (!n) return [];
    const per = 3 * this.size * this.size;
    const blob = new Float32Array(n * per);
    crops.forEach((c, i) => blobBgrSwapped(c, this.size, this.size, this.mean, this.std, blob, i * per));
    const s = this.session;
    const outs = await s.run({ [s.inputNames[0]]: new (await loadOrt()).Tensor("float32", blob, [n, 3, this.size, this.size]) });
    const data = outs[s.outputNames[0]].data as Float32Array;
    if (data.length % n !== 0) throw new Error(`recognition batch of ${n} gave ${data.length} values`);
    const d = data.length / n;
    return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d));
  }
}

/** insightface's ModelRouter task of a model file, from its graph. */
function taskOf(info: ModelInfo): string | null {
  const d2 = inputDim(info, 2);
  const d3 = inputDim(info, 3);
  if (info.outputs >= 5) return "detection";
  if (d2 === 192 && d3 === 192) return "landmark";
  if (d2 === 96 && d3 === 96) return "genderage";
  if (info.inputs.length === 2 && d2 === 128 && d3 === 128) return "inswapper";
  if (d2 !== null && d3 !== null && d2 === d3 && d2 >= 112 && d2 % 16 === 0) return "recognition";
  return null;
}

/** A detected face: the sidecar's (top, right, bottom, left) box plus insightface's float values. */
export interface Face {
  location: FaceBox;
  detection: Detection;
  embedding: Float32Array | null;
}

/** Which detected faces need an embedding: all, or those `_find_best_face_match` picks for these boxes. */
export type Want = "all" | FaceBox[];

export class FacePack {
  private constructor(
    readonly detector: Scrfd,
    readonly recognizer: ArcFace,
    readonly detSize: DetSize,
  ) {}

  /**
   * The first detection and the first recognition model of the pack
   * directory in sorted order (insightface's glob("*.onnx") skips dotfiles).
   */
  static async load(dir: string): Promise<FacePack> {
    const files = readdirSync(dir)
      .filter((n) => n.endsWith(".onnx") && !n.startsWith("."))
      .map((n) => path.join(dir, n))
      .filter((p) => statSync(p).isFile())
      .sort();
    let detection: [string, ModelInfo] | null = null;
    let recognition: [string, ModelInfo] | null = null;
    for (const f of files) {
      const info = readModelInfo(f);
      const task = taskOf(info);
      if (task === "detection" && !detection) detection = [f, info];
      else if (task === "recognition" && !recognition) recognition = [f, info];
    }
    if (!detection) throw new Error(`no detection model in ${dir}`);
    if (!recognition) throw new Error(`no recognition model in ${dir}`);
    // No per-session arena: it keeps every run's buffers at their high-water
    // mark (+65 MB here, same speed); librephotos-rs shrinks a shared one.
    const noArena = { enableCpuMemArena: false };
    const det = await session(detection[0], noArena);
    let rec: InferenceSession;
    try {
      // The batch axis is declared 1 in the graph: quiet ORT's shape warning for batched runs.
      rec = await session(recognition[0], { ...noArena, logSeverityLevel: 3 });
    } catch (e) {
      await det.release();
      throw e;
    }
    try {
      return new FacePack(new Scrfd(det, detection[1], [DET_SIZE, DET_SIZE]), new ArcFace(rec, recognition[1]), detSizeFromEnv());
    } catch (e) {
      await det.release();
      await rec.release();
      throw e;
    }
  }

  async release(): Promise<void> {
    await this.detector.session.release();
    await this.recognizer.session.release();
  }

  /** `FaceAnalysis.get(img)`, embedding the faces `wanted` asks for (one recognition run per photo). */
  async analyze(image: Rgb, wanted: Want): Promise<Face[]> {
    const dets = await this.detect(image);
    const faces: Face[] = dets.map((d) => ({ location: toFaceLocation(d.bbox), detection: d, embedding: null }));
    let embed: boolean[];
    if (wanted === "all") embed = faces.map(() => true);
    else {
      embed = faces.map(() => false);
      for (const i of bestFaceMatches(
        wanted,
        faces.map((f) => f.location),
      ))
        if (i !== null) embed[i] = true;
    }
    const idx: number[] = [];
    const crops: Uint8Array[] = [];
    faces.forEach((f, i) => {
      if (embed[i]) {
        crops.push(this.align(image, f.detection));
        idx.push(i);
      }
    });
    const embs = await this.recognizer.embedMany(crops);
    idx.forEach((i, k) => {
      faces[i].embedding = embs[k];
    });
    return faces;
  }

  /** Detection at the configured DetSize. */
  private async detect(image: Rgb): Promise<Detection[]> {
    const { data, width: w, height: h } = image;
    if (this.detSize !== "auto") return this.detector.detect(data, w, h, this.detSize);
    const coarse = 320;
    const dets = await this.detector.detect(data, w, h, coarse);
    const scale = coarse / Math.max(w, h);
    const small = dets.some((d) => Math.min(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1]) * scale < AUTO_SMALL_FACE);
    return small && Math.max(w, h) > coarse ? this.detector.detect(data, w, h, DET_SIZE) : dets;
  }

  /** `face_align.norm_crop(img, landmark=face.kps, image_size)`. */
  align(image: Rgb, det: Detection): Uint8Array {
    if (!det.kps) throw new Error("the detector gives no landmarks to align faces with");
    const m = estimateNorm(det.kps, this.recognizer.size);
    if (!m) throw new Error(`degenerate face landmarks ${JSON.stringify(det.kps)}`);
    return warpAffine(image.data, image.width, image.height, m, this.recognizer.size);
  }
}
