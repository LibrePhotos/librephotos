// insightface's SCRFD detector (model_zoo/retinaface.py, RetinaFace), float32
// throughout like the numpy code. Port of lp_ml::face::scrfd.
import { transferable } from "../ortThread";
import { loadOrt, type InferenceSession } from "../runtime";
import { resizeLinear } from "../preprocess/cv2";
import { inputDim, type ModelInfo } from "./onnx_meta";

const f32 = Math.fround;

export const NMS_THRESH = f32(0.4);
export const DET_THRESH = 0.5;
export const INPUT_MEAN = 127.5;
export const INPUT_STD = 128.0;

export type Kps = [number, number][];

/** One detected face in image coordinates (float32 values). */
export interface Detection {
  /** [x1, y1, x2, y2]. */
  bbox: [number, number, number, number];
  score: number;
  kps: Kps | null;
}

/**
 * `cv2.dnn.blobFromImage(img, 1/std, size, (mean,)*3, swapRB=True)` on an
 * image of the right size: NCHW float32, channels reversed,
 * `(x - mean) * float32(1/std)`. Written into `out` at `offset`.
 */
export function blobBgrSwapped(px: Uint8Array, w: number, h: number, mean: number, std: number, out = new Float32Array(3 * w * h), offset = 0): Float32Array {
  const plane = w * h;
  const scale = f32(1 / std);
  for (let i = 0; i < plane; i++) {
    out[offset + i] = (px[i * 3 + 2] - mean) * scale;
    out[offset + plane + i] = (px[i * 3 + 1] - mean) * scale;
    out[offset + 2 * plane + i] = (px[i * 3] - mean) * scale;
  }
  return out;
}

/** `values.argsort()[::-1]` with a stable sort: descending, ties by descending index. */
export function argsortDesc(values: ArrayLike<number>): number[] {
  const idx = Array.from({ length: values.length }, (_, i) => i);
  idx.sort((a, b) => values[a] - values[b]);
  return idx.reverse();
}

/** `RetinaFace.nms` over boxes (the `+1` pixel areas of the original); indices in keep order. */
function nms(boxes: [number, number, number, number][], scores: number[], thresh: number): number[] {
  const area = (b: [number, number, number, number]) => f32(f32(f32(b[2] - b[0]) + 1) * f32(f32(b[3] - b[1]) + 1));
  const areas = boxes.map(area);
  let order = argsortDesc(scores);
  const keep: number[] = [];
  while (order.length) {
    const i = order[0];
    keep.push(i);
    const bi = boxes[i];
    order = order.slice(1).filter((j) => {
      const bj = boxes[j];
      const xx1 = Math.max(bi[0], bj[0]);
      const yy1 = Math.max(bi[1], bj[1]);
      const xx2 = Math.min(bi[2], bj[2]);
      const yy2 = Math.min(bi[3], bj[3]);
      const ww = Math.max(0, f32(f32(xx2 - xx1) + 1));
      const hh = Math.max(0, f32(f32(yy2 - yy1) + 1));
      const inter = f32(ww * hh);
      const ovr = f32(inter / f32(f32(areas[i] + areas[j]) - inter));
      return ovr <= thresh;
    });
  }
  return keep;
}

export class Scrfd {
  private fmc: number;
  private strides: number[];
  private numAnchors: number;
  private useKps: boolean;
  /** [width, height]: fixed by the model, else det_size. */
  readonly inputSize: [number, number];
  /** The model takes any input size (det_size applies). */
  readonly dynamic: boolean;

  constructor(
    readonly session: InferenceSession,
    info: ModelInfo,
    detSize: [number, number],
  ) {
    const outputs = session.outputNames.length;
    const cfg: Record<number, [number, number[], number, boolean]> = {
      6: [3, [8, 16, 32], 2, false],
      9: [3, [8, 16, 32], 2, true],
      10: [5, [8, 16, 32, 64, 128], 1, false],
      15: [5, [8, 16, 32, 64, 128], 1, true],
    };
    const c = cfg[outputs];
    if (!c) throw new Error(`unsupported detector with ${outputs} outputs`);
    [this.fmc, this.strides, this.numAnchors, this.useKps] = c;
    const h = inputDim(info, 2);
    const w = inputDim(info, 3);
    if (h !== null && w !== null && h > 0 && w > 0) {
      this.inputSize = [w, h];
      this.dynamic = false;
    } else {
      this.inputSize = detSize;
      this.dynamic = true;
    }
  }

  /** `detect(img, max_num=0)` on an RGB image (fed as-is into the BGR API, like the sidecar), at a square `side` for a dynamic model. */
  async detect(rgb: Uint8Array, w: number, h: number, side?: number): Promise<Detection[]> {
    const [inW, inH] = side !== undefined && this.dynamic ? [side, side] : this.inputSize;
    const imRatio = h / w;
    const modelRatio = inH / inW;
    let newW: number;
    let newH: number;
    if (imRatio > modelRatio) {
      newH = inH;
      newW = Math.trunc(newH / imRatio);
    } else {
      newW = inW;
      newH = Math.trunc(newW * imRatio);
    }
    if (newW === 0 || newH === 0) throw new Error(`image ${w}x${h} is too narrow to detect faces in`);
    const detScale = f32(newH / h);
    const resized = resizeLinear(rgb, w, h, 3, newW, newH);
    const det = new Uint8Array(inW * inH * 3);
    for (let y = 0; y < newH; y++) det.set(resized.subarray(y * newW * 3, (y + 1) * newW * 3), y * inW * 3);
    const blob = blobBgrSwapped(det, inW, inH, INPUT_MEAN, INPUT_STD);

    const { scores, bboxes, kpss } = await this.forward(blob, inW, inH);
    const boxes = bboxes.map((b) => b.map((v) => f32(v / detScale)) as [number, number, number, number]);
    const order = argsortDesc(scores);
    const pre = order.map((i) => ({ i, bbox: boxes[i], score: scores[i] }));
    const keep = nms(
      pre.map((p) => p.bbox),
      pre.map((p) => p.score),
      NMS_THRESH,
    );
    return keep.map((k) => {
      const { i, bbox, score } = pre[k];
      return {
        bbox,
        score,
        kps: this.useKps ? kpss[i].map(([x, y]) => [f32(x / detScale), f32(y / detScale)] as [number, number]) : null,
      };
    });
  }

  private async forward(blob: Float32Array, inW: number, inH: number) {
    const s = this.session;
    const outs = await s.run({ [s.inputNames[0]]: transferable(new (await loadOrt()).Tensor("float32", blob, [1, 3, inH, inW])) });
    const out = (i: number) => outs[s.outputNames[i]].data as Float32Array;
    const scoresAll: number[] = [];
    const bboxesAll: [number, number, number, number][] = [];
    const kpssAll: Kps[] = [];
    const fmc = this.fmc;
    for (let idx = 0; idx < this.strides.length; idx++) {
      const stride = this.strides[idx];
      const scores = out(idx);
      const bboxPreds = out(idx + fmc);
      const kpsPreds = this.useKps ? out(idx + fmc * 2) : null;
      const height = Math.trunc(inH / stride);
      const width = Math.trunc(inW / stride);
      const n = height * width * this.numAnchors;
      if (scores.length < n || bboxPreds.length < n * 4) {
        throw new Error(`detector output for stride ${stride} has ${scores.length} scores, expected ${n}`);
      }
      if (kpsPreds && kpsPreds.length < n * 10) throw new Error(`detector landmarks for stride ${stride} are short`);
      for (let i = 0; i < n; i++) {
        const score = scores[i];
        // numpy's `scores >= threshold` also drops NaN.
        if (!(score >= DET_THRESH)) continue;
        const cell = Math.trunc(i / this.numAnchors);
        const cx = (cell % width) * stride;
        const cy = Math.trunc(cell / width) * stride;
        const d = i * 4;
        bboxesAll.push([
          f32(cx - f32(bboxPreds[d] * stride)),
          f32(cy - f32(bboxPreds[d + 1] * stride)),
          f32(cx + f32(bboxPreds[d + 2] * stride)),
          f32(cy + f32(bboxPreds[d + 3] * stride)),
        ]);
        scoresAll.push(score);
        if (kpsPreds) {
          const k = i * 10;
          const pts: Kps = [];
          for (let j = 0; j < 5; j++) pts.push([f32(cx + f32(kpsPreds[k + 2 * j] * stride)), f32(cy + f32(kpsPreds[k + 2 * j + 1] * stride))]);
          kpssAll.push(pts);
        }
      }
    }
    return { scores: scoresAll, bboxes: bboxesAll, kpss: kpssAll };
  }
}
