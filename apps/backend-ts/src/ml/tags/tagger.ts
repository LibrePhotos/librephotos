// The zero-shot taggers of service/tags (mobileclip/mobileclip.py,
// siglip2/siglip2.py; port of lp_ml::tags::tagger): embed the photo with the
// image tower, compare it with the cached text embeddings of every
// "a photo of {tag}" prompt, keep the best-scoring tags.
//
// The text tower only runs to build `<model dir>/tag_embeddings.npy` (the
// cache file the Python taggers and librephotos-rs write and read too) and
// is released again afterwards.
import { transferable } from "../ortThread";
import { existsSync } from "node:fs";
import path from "node:path";
import { ClipTokenizer } from "../clip/tokenizer";
import { loadRgb, resize, resizeShortestEdgeCenterCrop, toChw, type Rgb } from "../preprocess";
import { loadOrt, session, type Ort } from "../runtime";
import { readF32, writeF32 } from "./npy";
import { SentencePiece } from "./spm";
import { TAGS } from "./vocab";

export { TAGS };
export const PROMPT_TEMPLATE = "a photo of ";
export const CACHE_FILE = "tag_embeddings.npy";
export const MAX_TAGS = 10;

export type TaggingModel = "mobileclip_s2" | "siglip2";
export const DEFAULT_TAGGING_MODEL: TaggingModel = "mobileclip_s2";

export const taggingModelFromName = (name: string): TaggingModel | null =>
  name === "mobileclip_s2" || name === "siglip2" ? name : null;

/** TAGGERS[model][1]: MobileCLIP cuts on the softmax probability, SigLIP 2 on the raw cosine. */
export const threshold = (m: TaggingModel) => Math.fround(m === "mobileclip_s2" ? 0.02 : 0.05);
const textBatch = (m: TaggingModel) => (m === "mobileclip_s2" ? 64 : 32);
/** Tokens per prompt (padded to exactly this). */
const contextLength = (m: TaggingModel) => (m === "mobileclip_s2" ? 77 : 64);

const f = Math.fround;

/** `_stale_cache_reason`: why a cached embedding array cannot be used. */
export function staleCacheReason(model: TaggingModel, shape: number[], tagCount: number): string | null {
  if (shape.length !== 2) return `cache has wrong shape ${JSON.stringify(shape)}`;
  if (shape[0] !== tagCount) return `cache has ${shape[0]} tags but tags.txt has ${tagCount}`;
  if (model === "siglip2" && shape[1] < 128) return `cache has dim=${shape[1]} (likely stale from a failed build)`;
  return null;
}

/** `_l2_normalize` of one row in place (f32, `max(norm, 1e-8)`). */
function l2Normalize(v: Float32Array) {
  let acc = 0;
  for (let i = 0; i < v.length; i++) acc = f(acc + f(v[i] * v[i]));
  const norm = Math.max(f(Math.sqrt(acc)), f(1e-8));
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
}

interface Matrix {
  dims: number[];
  data: Float32Array;
}

/**
 * `_select_pooled_output`: the first 2-D output with `rows` rows, else the
 * first output pooled (2-D as is, 3-D at the last attended position, or
 * position 0 without a mask).
 */
function selectPooled(outputs: Matrix[], rows: number, mask: ArrayLike<number> | null): Float32Array {
  const two = outputs.find((m) => m.dims.length === 2 && m.dims[0] === rows);
  if (two) return two.data;
  const first = outputs[0];
  if (!first) throw new Error("the model has no outputs");
  if (first.dims.length === 2) return first.data;
  if (first.dims.length !== 3) throw new Error(`unexpected output shape ${JSON.stringify(first.dims)}`);
  const [b, seq, dim] = first.dims;
  const out = new Float32Array(b * dim);
  for (let i = 0; i < b; i++) {
    let pos = 0;
    if (mask) {
      let attended = 0;
      for (let j = 0; j < seq; j++) attended += mask[i * seq + j];
      // numpy indexes -1 as the last position.
      pos = attended > 0 ? attended - 1 : seq - 1;
    }
    out.set(first.data.subarray((i * seq + pos) * dim, (i * seq + pos + 1) * dim), i * dim);
  }
  return out;
}

async function runOutputs(s: Ort.InferenceSession, feeds: Record<string, Ort.Tensor>): Promise<Matrix[]> {
  const res = await s.run(feeds);
  return s.outputNames.map((n) => {
    const t = res[n];
    return { dims: t.dims.map((d) => Math.max(Number(d), 0)), data: t.data as Float32Array };
  });
}

/** `prepare_image` of decoded pixels: `[side, CHW pixels]`. */
export function prepareRgb(model: TaggingModel, img: Rgb): { size: number; pixels: Float32Array } {
  if (model === "mobileclip_s2") {
    // Shortest edge 256 (BILINEAR), centre crop, 0..1, no mean/std.
    const crop = resizeShortestEdgeCenterCrop(img.data, img.width, img.height, 256, "bilinear");
    return { size: 256, pixels: toChw(crop, 256, 256, [0, 0, 0], [1, 1, 1]) };
  }
  // Straight 384x384 BICUBIC, mean = std = 0.5.
  const sq = resize(img.data, img.width, img.height, 3, 384, 384, "bicubic");
  return { size: 384, pixels: toChw(sq, 384, 384, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]) };
}

export async function prepareImage(model: TaggingModel, file: string) {
  return prepareRgb(model, await loadRgb(file));
}

type PromptTokenizer = { kind: "hf"; t: ClipTokenizer } | { kind: "spm"; t: SentencePiece };

function loadTokenizer(model: TaggingModel, dir: string): PromptTokenizer {
  return model === "mobileclip_s2"
    ? { kind: "hf", t: ClipTokenizer.load(path.join(dir, "tokenizer.json")) }
    : { kind: "spm", t: SentencePiece.load(path.join(dir, "tokenizer.model")) };
}

function tokenizeWith(tok: PromptTokenizer, model: TaggingModel, prompts: readonly string[]) {
  const len = contextLength(model);
  const ids = new BigInt64Array(prompts.length * len);
  const mask = new BigInt64Array(prompts.length * len);
  prompts.forEach((p, i) => {
    // ids[:77] + [0] * pad, or (SigLIP 2) ids[:63] + [EOS=1] padded with 0.
    const row = tok.kind === "hf" ? tok.t.encode(p, len) : [...tok.t.encode(p).slice(0, len - 1), 1];
    row.forEach((v, j) => {
      ids[i * len + j] = BigInt(v);
      mask[i * len + j] = 1n;
    });
  });
  return { ids, mask, len };
}

/** Token ids and attention masks of `prompts`, `[n, context_length]` each, as Python's `_tokenize` pads them. */
export function tokenizePrompts(model: TaggingModel, dir: string, prompts: readonly string[]) {
  return tokenizeWith(loadTokenizer(model, dir), model, prompts);
}

/** `_build_tag_embeddings`: every prompt through the text tower, L2 normalised. */
export async function buildTagEmbeddings(model: TaggingModel, dir: string, tags: readonly string[]): Promise<{ dim: number; data: Float32Array }> {
  console.info(`building ${model} tag embeddings for ${tags.length} tags (first run only)`);
  const started = performance.now();
  const tok = loadTokenizer(model, dir);
  const ort = await loadOrt();
  const s = await session(path.join(dir, "text_model.onnx"));
  try {
    const prompts = tags.map((t) => PROMPT_TEMPLATE + t);
    const parts: Float32Array[] = [];
    let dim = 0;
    for (let at = 0; at < prompts.length; at += textBatch(model)) {
      const batch = prompts.slice(at, at + textBatch(model));
      const { ids, mask, len } = tokenizeWith(tok, model, batch);
      const n = batch.length;
      const feeds: Record<string, Ort.Tensor> = { [s.inputNames[0]]: new ort.Tensor("int64", ids, [n, len]) };
      if (model === "siglip2" && s.inputNames.length > 1) feeds[s.inputNames[1]] = new ort.Tensor("int64", mask, [n, len]);
      const outs = await runOutputs(s, feeds);
      const emb = Float32Array.from(selectPooled(outs, n, model === "siglip2" ? Array.from(mask, Number) : null));
      dim = emb.length / n;
      for (let i = 0; i < n; i++) l2Normalize(emb.subarray(i * dim, (i + 1) * dim));
      parts.push(emb);
    }
    const data = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      data.set(p, o);
      o += p.length;
    }
    console.info(`${model} tag embeddings built (dim ${dim}) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    return { dim, data };
  } finally {
    await s.release();
  }
}

/** Only one cache build at a time (SigLIP 2's text tower alone is 1.1 GB). */
let buildLock: Promise<unknown> = Promise.resolve();

/** `_load_or_build_tag_embeddings`: the cache, rebuilt (and rewritten) when missing or stale. */
export function loadOrBuildTagEmbeddings(
  model: TaggingModel,
  dir: string,
  build: () => Promise<{ dim: number; data: Float32Array }> = () => buildTagEmbeddings(model, dir, TAGS),
): Promise<{ dim: number; data: Float32Array }> {
  const run = async () => {
    const cache = path.join(dir, CACHE_FILE);
    if (existsSync(cache)) {
      try {
        const { shape, data } = readF32(cache);
        const reason = staleCacheReason(model, shape, TAGS.length);
        if (!reason) return { dim: shape[1], data };
        console.warn(`${model}: rebuilding tag embeddings: ${reason}`);
      } catch (e) {
        console.warn(`${model}: unreadable tag embeddings, rebuilding: ${(e as Error).message}`);
      }
    }
    const built = await build();
    try {
      writeF32(cache, [TAGS.length, built.dim], built.data);
    } catch (e) {
      // A read-only model dir costs a rebuild per load, not the service.
      console.warn(`${model}: could not cache the tag embeddings: ${(e as Error).message}`);
    }
    return built;
  };
  const p = buildLock.then(run, run);
  buildLock = p.catch(() => undefined);
  return p;
}

/** What a photo scored. */
export interface Prediction {
  tags: string[];
  /** Per tag: the softmax probability (MobileCLIP) or cosine (SigLIP 2). */
  scores: Float32Array;
  /** The L2-normalised image embedding. */
  embedding: Float32Array;
  /** The image tower's output as is (what CLIP search stores). */
  raw: Float32Array;
}

/** `_softmax(LOGIT_SCALE * similarities)` in f32. */
function softmaxScaled(v: Float32Array, scale: number) {
  let max = -Infinity;
  for (let i = 0; i < v.length; i++) {
    v[i] = v[i] * scale;
    if (v[i] > max) max = v[i];
  }
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] = Math.exp(f(v[i] - max));
    sum += v[i];
  }
  const s = f(sum);
  for (let i = 0; i < v.length; i++) v[i] = v[i] / s;
}

/** `_top_tags`: indices by descending score, stopping at the first under `threshold` or after `maxTags`. */
export function topTags(scores: ArrayLike<number>, min: number, maxTags: number): number[] {
  const order = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const out: number[] = [];
  for (const i of order) {
    if (!(scores[i] >= min) || out.length >= maxTags) break;
    out.push(i);
  }
  return out;
}

/** A loaded tagger: the image tower and the tag embeddings. */
export class Tagger {
  private constructor(
    readonly model: TaggingModel,
    readonly dir: string,
    private vision: Ort.InferenceSession,
    readonly dim: number,
    private embeddings: Float32Array,
  ) {}

  static async load(model: TaggingModel, dir: string): Promise<Tagger> {
    const vision = await session(path.join(dir, "vision_model.onnx"));
    try {
      const { dim, data } = await loadOrBuildTagEmbeddings(model, dir);
      return new Tagger(model, dir, vision, dim, data);
    } catch (e) {
      await vision.release();
      throw e;
    }
  }

  release() {
    return this.vision.release();
  }

  /** The image tower over `n` prepared photos of side `size` in one run: raw embeddings, in order. */
  async embedBatchRaw(size: number, images: Float32Array[]): Promise<Float32Array[]> {
    const n = images.length;
    if (!n) return [];
    const per = 3 * size * size;
    const data = new Float32Array(n * per);
    images.forEach((img, i) => {
      if (img.length !== per) throw new Error(`prepared image has ${img.length} values, expected ${per}`);
      data.set(img, i * per);
    });
    const ort = await loadOrt();
    const outs = await runOutputs(this.vision, { [this.vision.inputNames[0]]: transferable(new ort.Tensor("float32", data, [n, 3, size, size])) });
    const flat = selectPooled(outs, n, null);
    if (flat.length !== n * this.dim) {
      throw new Error(`batch of ${n} gave ${flat.length} values, the tag embeddings have ${this.dim} per image`);
    }
    return Array.from({ length: n }, (_, i) => flat.slice(i * this.dim, (i + 1) * this.dim));
  }

  /** The image tower's pooled output of one prepared photo, not normalised. */
  async embedPixelsRaw(size: number, pixels: Float32Array): Promise<Float32Array> {
    return (await this.embedBatchRaw(size, [pixels]))[0];
  }

  async predictPixels(size: number, pixels: Float32Array, min = threshold(this.model), maxTags = MAX_TAGS): Promise<Prediction> {
    return this.score(await this.embedPixelsRaw(size, pixels), min, maxTags);
  }

  /** `predict(image_path, threshold, max_tags)`. */
  async predict(file: string, min = threshold(this.model), maxTags = MAX_TAGS): Promise<Prediction> {
    const { size, pixels } = await prepareImage(this.model, file);
    return this.predictPixels(size, pixels, min, maxTags);
  }

  /** Tags of a raw image embedding. */
  score(raw: Float32Array, min: number, maxTags: number): Prediction {
    const embedding = Float32Array.from(raw);
    l2Normalize(embedding);
    const dim = this.dim;
    const n = this.embeddings.length / dim;
    const scores = new Float32Array(n);
    const e = this.embeddings;
    for (let t = 0; t < n; t++) {
      let acc = 0;
      const base = t * dim;
      for (let i = 0; i < dim; i++) acc = f(acc + f(e[base + i] * embedding[i]));
      scores[t] = acc;
    }
    if (this.model === "mobileclip_s2") softmaxScaled(scores, 100);
    const tags = topTags(scores, min, maxTags).map((i) => TAGS[i]);
    return { tags, scores, embedding, raw };
  }
}
