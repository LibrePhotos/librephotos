// In-process CLIP (port of lp_ml::clip::inprocess, i.e. the sidecar's
// service/clip_embeddings/clip_onnx.py): ViT-B/32 (Xenova ONNX export) and
// MobileCLIP-S2 image + text towers. Embeddings stay unnormalised, as the
// sidecar returns them, with their magnitude next to each one.
import { transferable } from "../ortThread";
import { existsSync } from "node:fs";
import path from "node:path";
import { MlFailed } from "../errors";
import { CLIP_MEAN, CLIP_STD, l2Norm, loadRgb, resizeShortestEdgeCenterCrop, stack, toChw } from "../preprocess";
import { loadOrt, modelSlot, MlUnavailable, session, type Ort } from "../runtime";
import { prepareImage as prepareTagger } from "../tags/tagger";
import { semanticOfDir, type SemanticModel } from "./model";
import { ClipTokenizer } from "./tokenizer";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

export const IMAGE_SIZE = 224;
export const CONTEXT_LENGTH = 77;
export const IMAGE_BATCH_SIZE = 32;
/** Photos decoded and resized at once (sharp decodes off the JS thread). */
const PREP_CONCURRENCY = 4;

const imageSize = (kind: SemanticModel) => (kind === "clip_vit_b32" ? IMAGE_SIZE : 256);

/** `prepare_image`: shortest-edge BICUBIC 224, centre crop, CLIP mean/std, CHW f32. */
export async function prepareClipImage(file: string): Promise<Float32Array> {
  const img = await loadRgb(file);
  const crop = resizeShortestEdgeCenterCrop(img.data, img.width, img.height, IMAGE_SIZE, "bicubic");
  return toChw(crop, IMAGE_SIZE, IMAGE_SIZE, CLIP_MEAN, CLIP_STD);
}

/** `prepare_image` of model `kind`: CLIP's, or MobileCLIP-S2's (as the tagger prepares it). */
export async function prepareFor(kind: SemanticModel, file: string): Promise<Float32Array> {
  return kind === "clip_vit_b32" ? prepareClipImage(file) : (await prepareTagger("mobileclip_s2", file)).pixels;
}

/**
 * The loaded model. ViT-B/32 loads both towers up front (as the sidecar
 * does); MobileCLIP-S2 loads each on first use, because its image tower
 * normally runs in the tags slot and only the text tower is needed here.
 */
export class Clip {
  private vision: Ort.InferenceSession | null = null;
  private text: Ort.InferenceSession | null = null;

  private constructor(
    readonly kind: SemanticModel,
    readonly dir: string,
    readonly tokenizer: ClipTokenizer,
  ) {}

  static async load(dir: string): Promise<Clip> {
    const clip = new Clip(semanticOfDir(dir), dir, ClipTokenizer.load(path.join(dir, "tokenizer.json")));
    if (clip.kind === "clip_vit_b32") {
      await clip.visionSession();
      await clip.textSession();
    }
    return clip;
  }

  private async visionSession() {
    return (this.vision ??= await session(path.join(this.dir, "vision_model.onnx")));
  }

  private async textSession() {
    return (this.text ??= await session(path.join(this.dir, "text_model.onnx")));
  }

  async release() {
    await this.vision?.release();
    await this.text?.release();
    this.vision = this.text = null;
  }

  /** One embedding per prepared image, in batches of 32. */
  async encodePixels(pixels: Float32Array[]): Promise<Float32Array[]> {
    const s = imageSize(this.kind);
    const per = 3 * s * s;
    const vision = await this.visionSession();
    const ort = await loadOrt();
    const out: Float32Array[] = [];
    for (let at = 0; at < pixels.length; at += IMAGE_BATCH_SIZE) {
      const batch = pixels.slice(at, at + IMAGE_BATCH_SIZE);
      const input = transferable(new ort.Tensor("float32", stack(batch, per), [batch.length, 3, s, s]));
      const res = await vision.run({ [vision.inputNames[0]]: input });
      const t = res[vision.outputNames[0]];
      const [n, d] = t.dims.map(Number);
      if (t.dims.length !== 2 || n !== batch.length || !(d > 0)) {
        throw new Error(`unexpected CLIP output shape ${JSON.stringify(t.dims)} for ${batch.length} inputs`);
      }
      const data = t.data as Float32Array;
      for (let i = 0; i < n; i++) out.push(data.slice(i * d, (i + 1) * d));
    }
    return out;
  }

  /** `encode_text`: ids truncated to 77; ViT-B/32 unpadded, MobileCLIP-S2 padded with 0 to 77. */
  async encodeText(text: string): Promise<Float32Array> {
    const ids = this.tokenizer.encode(text, CONTEXT_LENGTH);
    const n = this.kind === "mobileclip_s2" ? CONTEXT_LENGTH : ids.length;
    const data = new BigInt64Array(n);
    ids.forEach((v, i) => (data[i] = BigInt(v)));
    const s = await this.textSession();
    const ort = await loadOrt();
    const res = await s.run({ [s.inputNames[0]]: new ort.Tensor("int64", data, [1, n]) });
    const t = res[s.outputNames[0]];
    if (t.dims.length !== 2 || Number(t.dims[0]) !== 1) throw new Error(`unexpected CLIP output shape ${JSON.stringify(t.dims)} for 1 input`);
    return (t.data as Float32Array).slice(0, Number(t.dims[1]));
  }
}

function slotFor(dir: string) {
  if (!existsSync(path.join(dir, "vision_model.onnx"))) throw new MlUnavailable(`CLIP model missing under ${dir}`);
  return modelSlot<Clip>("clip", dir, () => Clip.load(dir), (c) => c.release());
}

async function mapLimit<T, R>(items: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface ImageEmbeddings {
  /** One slot per path, null where the image is unreadable. */
  imgs_emb: (Float32Array | null)[];
  magnitudes: (number | null)[];
}

/** POST /clip-embeddings {imgs, model}: `model` is the model directory. */
export async function imageEmbeddings(imgs: string[], modelDir: string): Promise<ImageEmbeddings> {
  const kind = semanticOfDir(modelDir);
  const slot = slotFor(modelDir);
  const prepared = await mapLimit(imgs, PREP_CONCURRENCY, async (p) => {
    try {
      return await prepareFor(kind, p);
    } catch (e) {
      console.warn(`clip embeddings: skipping unreadable image ${p}: ${(e as Error).message}`);
      return null;
    }
  });
  const slots = prepared.flatMap((t, i) => (t ? [i] : []));
  const pixels = prepared.filter((t): t is Float32Array => t !== null);
  let embeddings: Float32Array[] = [];
  if (pixels.length) {
    try {
      embeddings = await slot.run((clip) => clip.encodePixels(pixels));
    } catch (e) {
      if (e instanceof MlUnavailable) throw e;
      throw new MlFailed(500, (e as Error).message);
    }
  }
  const imgs_emb: (Float32Array | null)[] = new Array(imgs.length).fill(null);
  const magnitudes: (number | null)[] = new Array(imgs.length).fill(null);
  slots.forEach((i, k) => {
    imgs_emb[i] = embeddings[k];
    magnitudes[i] = l2Norm(embeddings[k]);
  });
  return { imgs_emb, magnitudes };
}

/** POST /query-embeddings {query, model}. */
export async function queryEmbedding(query: string, modelDir: string): Promise<{ emb: Float32Array; magnitude: number }> {
  const slot = slotFor(modelDir);
  let emb: Float32Array;
  try {
    emb = await slot.run((clip) => clip.encodeText(query));
  } catch (e) {
    if (e instanceof MlUnavailable) throw e;
    throw new MlFailed(500, (e as Error).message);
  }
  return { emb, magnitude: l2Norm(emb) };
}
