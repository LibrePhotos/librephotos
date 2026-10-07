// LFM2.5-VL-450M on ONNX Runtime (port of lp_ml::caption::lfm2_vl, itself a
// port of service/image_captioning/lfm2_vl.py).
//
// Three graphs: the vision encoder (16x16 patches in, projected image tokens
// out), the token embedding, and a merged decoder with a KV cache plus the
// short convolution state of the LFM2 layers. Greedy decoding up to
// `<|im_end|>` or 64 tokens. Preprocessing is the single-tile case of
// transformers' `Lfm2VlImageProcessor`: smart-resize to a multiple of 32
// within 64..=256 image tokens with Pillow's BILINEAR, mean/std 0.5, patches
// flattened as (ph, pw, C).
//
// The decode loop allocates nothing per token that ORT does not: the cache
// is ping-ponged between two preallocated buffers per input (ORT writes each
// `present*` output straight into the buffer the next step reads as `past*`),
// the logits row and the next token's embedding go into fixed buffers, and
// the attention mask is a view of one ones-filled array.
import path from "node:path";
import { loadRgb, pyRound, resize, type Rgb } from "../preprocess";
import { loadOrt, session, type Ort } from "../runtime";
import { Lfm2Tokenizer } from "./tokenizer";

export const MODEL_NAME = "lfm2_vl_450m";

const VISION_FILE = "vision_encoder_q4.onnx";
const EMBED_FILE = "embed_tokens_q4.onnx";
const DECODER_FILE = "decoder_model_merged_q4.onnx";
const TOKENIZER_FILE = "tokenizer.json";

/** Every file of the model (lp_ml::models CATALOG, ml_type Captioning). */
export const MODEL_FILES = [
  VISION_FILE,
  `${VISION_FILE}_data`,
  EMBED_FILE,
  `${EMBED_FILE}_data`,
  DECODER_FILE,
  `${DECODER_FILE}_data`,
  TOKENIZER_FILE,
];

const PATCH_SIZE = 16;
const PATCH_LEN = PATCH_SIZE * PATCH_SIZE * 3;
const DOWNSAMPLE = 2;
const RESIZE_FACTOR = PATCH_SIZE * DOWNSAMPLE;
const MIN_PIXELS = 64 * RESIZE_FACTOR * RESIZE_FACTOR;
const MAX_PIXELS = 256 * RESIZE_FACTOR * RESIZE_FACTOR;

const BOS_TOKEN = "<|startoftext|>";
const IMAGE_START = "<|image_start|>";
const IMAGE_END = "<|image_end|>";
const IMAGE_TOKEN = "<image>";
const IMAGE_TOKEN_ID = 396;
/** `<|im_end|>`, the end of an assistant turn. */
const IM_END_ID = 7;

export const DEFAULT_PROMPT = "Describe this image in a short, natural image caption.";
export const DEFAULT_MAX_NEW_TOKENS = 64;

/** `smart_resize(height, width)`: the [height, width] to resize to, multiples of 32 within the image-token budget. */
export function smartResize(height: number, width: number): [number, number] {
  const f = RESIZE_FACTOR;
  let hBar = Math.max(f, pyRound(height / f) * f);
  let wBar = Math.max(f, pyRound(width / f) * f);
  if (hBar * wBar > MAX_PIXELS) {
    const beta = Math.sqrt((height * width) / MAX_PIXELS);
    hBar = Math.max(f, Math.floor(height / beta / f) * f);
    wBar = Math.max(f, Math.floor(width / beta / f) * f);
  } else if (hBar * wBar < MIN_PIXELS) {
    const beta = Math.sqrt(MIN_PIXELS / (height * width));
    hBar = Math.ceil((height * beta) / f) * f;
    wBar = Math.ceil((width * beta) / f) * f;
  }
  return [hBar, wBar];
}

/** `prepare_image`'s tensors for one image. */
export interface Patches {
  /** `(patchesH * patchesW) x 768`, row-major. */
  pixelValues: Float32Array;
  patchesH: number;
  patchesW: number;
  /** The resized [width, height]. */
  resized: [number, number];
}

export const imageTokens = (p: Patches) => (p.patchesH * p.patchesW) / (DOWNSAMPLE * DOWNSAMPLE);

/** numpy's float32 `(v / 255.0 - 0.5) / 0.5` for every byte value. */
const NORM = (() => {
  const f = Math.fround;
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = f(f(v / 255) - 0.5) / 0.5;
  return lut;
})();

/** `prepare_image(image)`: resize, normalise, cut into patches. */
export function prepareImage(img: Rgb): Patches {
  const [h, w] = smartResize(img.height, img.width);
  const px = resize(img.data, img.width, img.height, 3, w, h, "bilinear");
  const ph = h / PATCH_SIZE;
  const pw = w / PATCH_SIZE;
  const out = new Float32Array(ph * pw * PATCH_LEN);
  let o = 0;
  // (h, w, 3) -> (ph, 16, pw, 16, 3) -> (ph, pw, 16, 16, 3)
  for (let py = 0; py < ph; py++) {
    for (let pxi = 0; pxi < pw; pxi++) {
      for (let y = 0; y < PATCH_SIZE; y++) {
        const start = ((py * PATCH_SIZE + y) * w + pxi * PATCH_SIZE) * 3;
        for (let i = start, end = start + PATCH_SIZE * 3; i < end; i++) out[o++] = NORM[px[i]];
      }
    }
  }
  return { pixelValues: out, patchesH: ph, patchesW: pw, resized: [w, h] };
}

/** Python's `str.strip()` whitespace (also the \x1c..\x1f separators, not U+FEFF). */
const PY_WS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu");
const pyStrip = (s: string) => s.replace(PY_STRIP, "");

/** `clean_caption`: strip the quotation marks the model wraps a caption in. */
export function cleanCaption(text: string): string {
  const t = pyStrip(text);
  if (t.length >= 2 && t[0] === t[t.length - 1] && (t[0] === '"' || t[0] === "'")) return pyStrip(t.slice(1, -1));
  return t;
}

/** The chat-formatted prompt with `nImage` image slots. */
export const promptText = (nImage: number, prompt: string) =>
  `${BOS_TOKEN}<|im_start|>user\n${IMAGE_START}${IMAGE_TOKEN.repeat(nImage)}${IMAGE_END}${prompt}<|im_end|>\n<|im_start|>assistant\n`;

/** IEEE 754 binary16 to binary32 (exact). */
export function f16ToF32(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** numpy's `argmax` over `v[from, from + n)`: the first maximum; NaN wins like in numpy. */
export function argmax(v: ArrayLike<number>, from = 0, n = v.length - from): number {
  let best = from;
  let bestV = v[from];
  if (bestV !== bestV) return 0;
  for (let i = from + 1, end = from + n; i < end; i++) {
    const x = v[i];
    if (x !== x) return i - from;
    if (x > bestV) {
      bestV = x;
      best = i;
    }
  }
  return best - from;
}

/** A float tensor (f32 or f16) as f32 values. */
function floats(t: Ort.Tensor): Float32Array {
  if (t.type === "float32") return t.data as Float32Array;
  if (t.type === "float16") return Float32Array.from(t.data as Uint16Array, f16ToF32);
  throw new Error(`expected a float tensor, got ${t.type}`);
}

/** One decoder cache input: its output, the shape of one token's slice, and the ping-pong buffers. */
interface CacheSlot {
  input: string;
  output: string;
  conv: boolean;
  /** [heads, headDim] of a KV input, [channels, kernel] of a conv state. */
  dims: [number, number];
}

type CacheData = Float32Array | Uint16Array;

/** What one caption produced (the golden and benchmark hooks use the parts). */
export interface Generated {
  caption: string;
  tokenIds: number[];
  promptIds: number[];
  imageTokens: number;
  /** The resized [width, height]. */
  resized: [number, number];
  /** Wall time of the prefill step and the decoder steps after it (ms). */
  prefillMs: number;
  decodeMs: number;
}

/** The loaded model: three sessions and the tokenizer. */
export class Lfm2Vl {
  private constructor(
    private ort: typeof Ort,
    private vision: Ort.InferenceSession,
    private embed: Ort.InferenceSession,
    private decoder: Ort.InferenceSession,
    readonly tokenizer: Lfm2Tokenizer,
    private cache: CacheSlot[],
    readonly cacheDtype: "float32" | "float16",
    private numLogitsToKeep: boolean,
    private hidden: number,
    private vocab: number,
  ) {}

  static modelFiles(dir: string): string[] {
    return MODEL_FILES.map((f) => path.join(dir, f));
  }

  /** `Lfm2VlCaptioner.load()`. A model that fails to load releases what it opened. */
  static async load(dir: string): Promise<Lfm2Vl> {
    const ort = await loadOrt();
    const opened: Ort.InferenceSession[] = [];
    try {
      const open = async (f: string) => {
        const s = await session(path.join(dir, f)).catch((e: Error) => {
          throw new Error(`loading ${path.join(dir, f)}: ${e.message}`);
        });
        opened.push(s);
        return s;
      };
      const vision = await open(VISION_FILE);
      const embed = await open(EMBED_FILE);
      const decoder = await open(DECODER_FILE);
      const tokenizer = Lfm2Tokenizer.load(path.join(dir, TOKENIZER_FILE));

      const meta = decoder.inputMetadata;
      const kv = meta.find((m) => m.name.startsWith("past_key_values."));
      if (!kv) throw new Error(`${DECODER_FILE} has no past_key_values inputs`);
      const cacheDtype = kv.isTensor && kv.type === "float16" ? "float16" : "float32";
      const cache: CacheSlot[] = [];
      let numLogitsToKeep = false;
      for (const m of meta) {
        if (m.name === "num_logits_to_keep") {
          numLogitsToKeep = true;
          continue;
        }
        const conv = m.name.startsWith("past_conv.");
        if (!conv && !m.name.startsWith("past_key_values.")) continue;
        const shape = m.isTensor ? m.shape : [];
        if (shape.length !== (conv ? 3 : 4)) throw new Error(`unexpected cache input ${m.name}: ${JSON.stringify(shape)}`);
        const dims: [unknown, unknown] = conv ? [shape[1], shape[2]] : [shape[1], shape[3]];
        if (!dims.every((d) => typeof d === "number" && d > 0)) throw new Error(`cache input ${m.name} has a dynamic head/channel dimension`);
        const output = conv ? `present_conv.${m.name.slice("past_conv.".length)}` : `present.${m.name.slice("past_key_values.".length)}`;
        if (!decoder.outputNames.includes(output)) throw new Error(`${DECODER_FILE} has no ${output} output`);
        cache.push({ input: m.name, output, conv, dims: dims as [number, number] });
      }
      if (!decoder.outputNames.includes("logits")) throw new Error(`decoder has no logits output (${decoder.outputNames.join(", ")})`);
      const dimOf = (md: readonly Ort.InferenceSession.ValueMetadata[], name: string, i: number) => {
        const m = md.find((x) => x.name === name);
        const d = m?.isTensor ? m.shape[i] : undefined;
        if (typeof d !== "number" || d <= 0) throw new Error(`${name} has no fixed dimension ${i}`);
        return d;
      };
      const hidden = dimOf(embed.outputMetadata, "inputs_embeds", 2);
      const vocab = dimOf(decoder.outputMetadata, "logits", 2);
      return new Lfm2Vl(ort, vision, embed, decoder, tokenizer, cache, cacheDtype, numLogitsToKeep, hidden, vocab);
    } catch (e) {
      for (const s of opened) await s.release().catch(() => {});
      throw e;
    }
  }

  async release() {
    await this.vision.release();
    await this.embed.release();
    await this.decoder.release();
  }

  /** `_image_features`: the vision tower's `(image_tokens, hidden)` output. */
  async imageFeatures(p: Patches): Promise<{ dims: number[]; data: Float32Array }> {
    const ort = this.ort;
    const n = p.patchesH * p.patchesW;
    const res = await this.vision.run({
      pixel_values: new ort.Tensor("float32", p.pixelValues, [1, n, PATCH_LEN]),
      pixel_attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]),
      spatial_shapes: new ort.Tensor("int64", BigInt64Array.from([BigInt(p.patchesH), BigInt(p.patchesW)]), [1, 2]),
    });
    const t = res[this.vision.outputNames[0]];
    return { dims: t.dims.map(Number), data: floats(t) };
  }

  /** `_prompt_embeddings`: the prompt's embeddings with the image tokens swapped in; also the prompt ids. */
  private async promptEmbeddings(features: Float32Array, nImage: number, prompt: string): Promise<{ ids: number[]; embeds: Float32Array }> {
    const ids = this.tokenizer.encode(promptText(nImage, prompt), false);
    const res = await this.embed.run({
      input_ids: new this.ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    });
    const embeds = floats(res.inputs_embeds);
    const hidden = this.hidden;
    let k = 0;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] !== IMAGE_TOKEN_ID) continue;
      if (k >= nImage) {
        k++;
        continue;
      }
      embeds.set(features.subarray(k * hidden, (k + 1) * hidden), i * hidden);
      k++;
    }
    if (k !== nImage) throw new Error(`prompt carries ${k} image slots for ${nImage} image tokens`);
    if (features.length !== nImage * hidden) throw new Error(`image features have ${features.length} values for ${nImage} x ${hidden}`);
    return { ids, embeds };
  }

  /** `_decode`: greedy decoding from the prompt embeddings. */
  private async decode(promptEmbeds: Float32Array, maxNewTokens: number): Promise<{ ids: number[]; prefillMs: number; decodeMs: number }> {
    const ort = this.ort;
    const hidden = this.hidden;
    const vocab = this.vocab;
    const promptLen = promptEmbeds.length / hidden;
    const maxTotal = promptLen + maxNewTokens;
    const f16 = this.cacheDtype === "float16";
    const alloc = (n: number): CacheData => (f16 ? new Uint16Array(n) : new Float32Array(n));

    // Two buffers per cache input, each big enough for the longest sequence.
    const bufs = this.cache.map((c) => {
      const n = c.conv ? c.dims[0] * c.dims[1] : c.dims[0] * maxTotal * c.dims[1];
      return [alloc(n), alloc(n)] as [CacheData, CacheData];
    });
    const view = (c: CacheSlot, buf: CacheData, len: number): Ort.Tensor => {
      const dims = c.conv ? [1, c.dims[0], c.dims[1]] : [1, c.dims[0], len, c.dims[1]];
      const n = c.conv ? c.dims[0] * c.dims[1] : c.dims[0] * len * c.dims[1];
      return buf instanceof Uint16Array ? new ort.Tensor("float16", buf.subarray(0, n), dims) : new ort.Tensor("float32", buf.subarray(0, n), dims);
    };
    const mask = new BigInt64Array(maxTotal).fill(1n);
    const keep = new ort.Tensor("int64", BigInt64Array.of(1n), []);
    const logitsBuf = new Float32Array(vocab);
    const logitsF16 = f16 ? new Uint16Array(vocab) : null;
    const nextId = new BigInt64Array(1);
    const nextEmbed = new Float32Array(hidden);
    const idTensor = new ort.Tensor("int64", nextId, [1, 1]);

    const feeds: Record<string, Ort.Tensor> = {};
    const fetches: Record<string, Ort.OnnxValue | null> = {};
    const logitsOut = logitsF16 ? new ort.Tensor("float16", logitsF16, [1, 1, vocab]) : new ort.Tensor("float32", logitsBuf, [1, 1, vocab]);
    const embedOut = { inputs_embeds: new ort.Tensor("float32", nextEmbed, [1, 1, hidden]) };
    let current = new ort.Tensor("float32", promptEmbeds, [1, promptLen, hidden]);
    const generated: number[] = [];
    let prefillMs = 0;
    const t0 = performance.now();
    for (let step = 0; step < maxNewTokens; step++) {
      const total = promptLen + step;
      const past = step === 0 ? 0 : total - 1;
      feeds.inputs_embeds = current;
      feeds.attention_mask = new ort.Tensor("int64", mask.subarray(0, total), [1, total]);
      if (this.numLogitsToKeep) feeds.num_logits_to_keep = keep;
      const src = step & 1;
      this.cache.forEach((c, i) => {
        feeds[c.input] = view(c, bufs[i][src], past);
        fetches[c.output] = view(c, bufs[i][src ^ 1], total);
      });
      // With num_logits_to_keep the logits are one row; without it the prefill's are the whole prompt.
      const oneRow = this.numLogitsToKeep || step > 0;
      fetches.logits = oneRow ? logitsOut : null;
      const out = await this.decoder.run(feeds, fetches);
      let next: number;
      if (oneRow) {
        if (logitsF16) for (let i = 0; i < vocab; i++) logitsBuf[i] = f16ToF32(logitsF16[i]);
        next = argmax(logitsBuf);
      } else {
        const all = floats(out.logits);
        next = argmax(all, all.length - vocab, vocab);
      }
      if (step === 0) prefillMs = performance.now() - t0;
      if (next === IM_END_ID) break;
      generated.push(next);
      nextId[0] = BigInt(next);
      await this.embed.run({ input_ids: idTensor }, embedOut);
      current = embedOut.inputs_embeds;
    }
    return { ids: generated, prefillMs, decodeMs: performance.now() - t0 - prefillMs };
  }

  /** `caption(image_path, prompt)` on a decoded image, with the parts. */
  async generate(img: Rgb, prompt: string, maxNewTokens = DEFAULT_MAX_NEW_TOKENS): Promise<Generated> {
    return this.generatePatches(prepareImage(img), prompt, maxNewTokens);
  }

  /** {@link generate} from prepared patches (the preparation can run outside the model's slot). */
  async generatePatches(patches: Patches, prompt: string, maxNewTokens = DEFAULT_MAX_NEW_TOKENS): Promise<Generated> {
    const { dims, data } = await this.imageFeatures(patches);
    const nImage = dims[0] ?? 0;
    const { ids: promptIds, embeds } = await this.promptEmbeddings(data, nImage, prompt);
    const { ids, prefillMs, decodeMs } = await this.decode(embeds, maxNewTokens);
    return {
      caption: cleanCaption(this.tokenizer.decode(ids, true)),
      tokenIds: ids,
      promptIds,
      imageTokens: nImage,
      resized: patches.resized,
      prefillMs,
      decodeMs,
    };
  }
}

/** `Lfm2VlCaptioner.caption(image_path, prompt)`'s preparation: decode and patch the image. */
export async function prepareFile(imagePath: string): Promise<Patches> {
  return prepareImage(await loadRgb(imagePath));
}
