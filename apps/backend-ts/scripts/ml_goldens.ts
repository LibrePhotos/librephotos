// Golden parity of the in-process clip / tags / similarity / preprocess
// ports against the Python reference outputs (apps/backend-rs/tests/ml,
// the goldens librephotos-rs's lp-ml tests use), with Rust's tolerances.
//
//   ONNX_INTRA_OP_THREADS=4 bun run scripts/ml_goldens.ts [section...]
//
// Sections: preprocess tokenize clip_text clip_images clip_edge tags_text
// tags_mobileclip tags_siglip2 tags_edge tags_fresh similarity (default: all).
// LP_ML_GOLDENS (default <librephotos>/rust-pg/ml-goldens) and LP_DATA_MODELS
// (default <librephotos>/rust-pg/ml/protected_media/data_models);
// LP_ML_SLOW_TESTS=1 adds SigLIP 2's text tower (1.1 GB).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const GOLDENS = process.env.LP_ML_GOLDENS ?? path.join(ROOT, "rust-pg", "ml-goldens");
process.env.LP_DATA_MODELS ??= path.join(ROOT, "rust-pg", "ml", "protected_media", "data_models");
process.env.LP_ML_IDLE_UNLOAD_SECS ??= "0";
const MODELS = process.env.LP_DATA_MODELS;

const { ClipTokenizer } = await import("../src/ml/clip/tokenizer");
const clip = await import("../src/ml/clip/inprocess");
const pre = await import("../src/ml/preprocess");
const tagger = await import("../src/ml/tags/tagger");
const { SimilarityStore } = await import("../src/ml/similarity/inprocess");
const { dot } = await import("../src/ml/similarity/index");

interface Case {
  id: string;
  input: Record<string, any>;
  output: Record<string, any>;
}
interface Golden {
  meta: Record<string, any>;
  cases: Case[];
}

async function load(service: string, name: string): Promise<Golden | null> {
  const p = path.join(GOLDENS, service, `${name}.json`);
  if (!existsSync(p)) {
    console.log(`  golden ${p} missing, skipping`);
    return null;
  }
  return (await Bun.file(p).json()) as Golden;
}

function bytesOf(a: { b64: string }): Uint8Array {
  return new Uint8Array(Buffer.from(a.b64, "base64"));
}
function f32(a: { dtype: string; b64: string }): Float32Array {
  const b = bytesOf(a);
  if (a.dtype === "float32") return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (a.dtype === "float64") return Float32Array.from(new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8));
  throw new Error(`not a float array: ${a.dtype}`);
}
function i64(a: { dtype: string; b64: string }): number[] {
  const b = bytesOf(a);
  if (a.dtype === "int64") return Array.from(new BigInt64Array(b.buffer, b.byteOffset, b.byteLength / 8), Number);
  if (a.dtype === "int32") return Array.from(new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4));
  throw new Error(`not an int array: ${a.dtype}`);
}
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`lengths ${a.length} vs ${b.length}`);
  let d = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return na === nb ? 1 : 0;
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}
function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
function u8Diff(a: Uint8Array, b: Uint8Array): [number, number] {
  if (a.length !== b.length) return [255, Math.max(a.length, b.length)];
  let max = 0,
    n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) {
      n++;
      max = Math.max(max, d);
    }
  }
  return [max, n];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const failures: string[] = [];
const summary: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

// ------------------------------------------------------------- preprocess

async function preprocess() {
  const g = await load("preprocess", "resize");
  if (!g) return;
  const t = new Map<string, { cases: number; exact: number; max: number }>();
  const decode = new Map<string, [number, number, number]>();
  const rec = (k: string, ours: Uint8Array, want: Uint8Array) => {
    const [max, n] = u8Diff(ours, want);
    const e = t.get(k) ?? { cases: 0, exact: 0, max: 0 };
    e.cases++;
    e.exact += n === 0 ? 1 : 0;
    e.max = Math.max(e.max, max);
    t.set(k, e);
  };
  for (const c of g.cases) {
    const src = await pre.loadRgb(c.input.decoded_png);
    const { width: w, height: h, data } = src;
    const o = c.output;
    const [ow, oh] = c.input.odd;
    try {
      const ours = await pre.loadRgb(c.input.image);
      if (ours.width === w && ours.height === h) {
        const ext = path.extname(c.input.image).toLowerCase();
        const [max, n] = u8Diff(ours.data, data);
        const e = decode.get(ext) ?? [0, 0, 0];
        decode.set(ext, [e[0] + (n === 0 ? 1 : 0), e[1] + 1, Math.max(e[2], max)]);
      }
    } catch {
      /* informational */
    }
    const crop224 = pre.resizeShortestEdgeCenterCrop(data, w, h, 224, "bicubic");
    rec("pil_bicubic_crop224", crop224, bytesOf(o.pil_bicubic_crop224));
    rec("pil_bilinear_crop256", pre.resizeShortestEdgeCenterCrop(data, w, h, 256, "bilinear"), bytesOf(o.pil_bilinear_crop256));
    rec("pil_bicubic_224x224", pre.resize(data, w, h, 3, 224, 224, "bicubic"), bytesOf(o.pil_bicubic_224x224));
    rec("pil_bilinear_odd", pre.resize(data, w, h, 3, ow, oh, "bilinear"), bytesOf(o.pil_bilinear_odd));
    rec("pil_lanczos_odd", pre.resize(data, w, h, 3, ow, oh, "lanczos"), bytesOf(o.pil_lanczos_odd));
    if (o.clip_tensor) {
      const ours = pre.toChw(crop224, 224, 224, pre.CLIP_MEAN, pre.CLIP_STD);
      const d = maxAbsDiff(ours, f32(o.clip_tensor));
      check(d === 0, `preprocess ${c.id}: CLIP tensor differs by ${d}`);
      rec("clip_tensor (f32 bits)", new Uint8Array(ours.buffer), bytesOf(o.clip_tensor));
    }
  }
  for (const [k, v] of t) {
    summary.push(`preprocess ${k}: ${v.exact}/${v.cases} bit-exact (max diff ${v.max})`);
    check(v.exact === v.cases, `preprocess ${k}: ${v.cases - v.exact} of ${v.cases} differ`);
  }
  for (const [ext, [s, n, m]] of decode) summary.push(`preprocess decode ${ext} vs Pillow: ${s}/${n} identical, max diff ${m}`);
  console.log("  (cv2_* resizes are OCR/face operations, not ported here)");
}

async function tokenize() {
  const g = await load("preprocess", "tokenize");
  if (g) {
    let ok = 0,
      n = 0;
    const cache = new Map<string, InstanceType<typeof ClipTokenizer>>();
    for (const c of g.cases) {
      if (!["clip_vit_b32", "mobileclip_s2"].includes(c.input.model)) continue;
      let t = cache.get(c.input.tokenizer);
      if (!t) cache.set(c.input.tokenizer, (t = ClipTokenizer.load(c.input.tokenizer)));
      n++;
      const good = same(t.encode(c.input.text), c.output.ids);
      ok += good ? 1 : 0;
      check(good, `tokenize ${c.id}`);
    }
    summary.push(`tokenize (CLIP + MobileCLIP tokenizer.json): ${ok}/${n} identical ids (LFM2 tokenizer is captioning's, skipped)`);
  }
}

// ------------------------------------------------------------- clip

async function clipText() {
  const g = await load("clip", "text");
  if (!g) return;
  const dir = path.join(MODELS, "clip_vit_b32");
  const tok = ClipTokenizer.load(path.join(dir, "tokenizer.json"));
  let worst = 1,
    maxDiff = 0,
    magErr = 0;
  for (const c of g.cases) {
    const q = c.input.query as string;
    check(same(tok.encode(q, 77), i64(c.output.ids)), `clip text ${c.id}: ids`);
    const { emb, magnitude } = await clip.queryEmbedding(q, dir);
    const want = f32(c.output.embedding);
    const cos = cosine(emb, want);
    worst = Math.min(worst, cos);
    maxDiff = Math.max(maxDiff, maxAbsDiff(emb, want));
    check(cos >= 0.998, `clip text ${c.id}: cosine ${cos}`);
    const rel = Math.abs(magnitude - c.output.magnitude) / c.output.magnitude;
    magErr = Math.max(magErr, rel);
    check(rel < 1e-4, `clip text ${c.id}: magnitude`);
  }
  summary.push(`clip text (${g.cases.length} queries): ids identical, min cosine ${worst.toFixed(8)}, max abs diff ${maxDiff.toExponential(2)}, magnitude rel err ${magErr.toExponential(2)}`);
}

async function clipImages(name: string) {
  const g = await load("clip", name);
  if (!g) return;
  const dir = path.join(MODELS, "clip_vit_b32");
  const imgs = g.cases.map((c) => c.input.image as string);
  const started = performance.now();
  const reply = await clip.imageEmbeddings(imgs, dir);
  const secs = (performance.now() - started) / 1000;
  let worst = 1,
    worstId = "",
    empty = 0,
    magErr = 0;
  const byKind = new Map<string, [number, number]>();
  g.cases.forEach((c, i) => {
    const got = reply.imgs_emb[i];
    if (c.output.embedding === null) {
      empty++;
      check(got === null && reply.magnitudes[i] === null, `clip ${name} ${c.id}: expected no embedding`);
      return;
    }
    if (!got) {
      check(false, `clip ${name} ${c.id}: no embedding`);
      return;
    }
    const cos = cosine(got, f32(c.output.embedding));
    const kind = path.extname(c.id).toLowerCase() || "?";
    const e = byKind.get(kind) ?? [0, 1];
    byKind.set(kind, [e[0] + 1, Math.min(e[1], cos)]);
    if (cos < worst) {
      worst = cos;
      worstId = c.id;
    }
    magErr = Math.max(magErr, Math.abs(reply.magnitudes[i]! - c.output.magnitude) / c.output.magnitude);
    check(cos >= 0.998, `clip ${name} ${c.id}: cosine ${cos.toFixed(6)} < 0.998`);
  });
  const kinds = [...byKind].map(([k, [n, m]]) => `${k} ${n}x min ${m.toFixed(6)}`).join(", ");
  summary.push(
    `clip ${name} (${imgs.length} images in ${secs.toFixed(1)} s incl. load): ${empty} unreadable as in Python; min cosine ${worst.toFixed(6)} (${worstId}); magnitude rel err ${magErr.toExponential(2)}; ${kinds}`,
  );
}

// ------------------------------------------------------------- tags

const strings = (v: any) => (v as string[]).slice();
const modelDir = (m: string) => {
  const d = path.join(MODELS, m);
  return existsSync(path.join(d, "vision_model.onnx")) ? d : null;
};

async function tagsText() {
  const g = await load("tags", "text");
  if (!g) return;
  for (const c of g.cases) {
    const model = c.id as "mobileclip_s2" | "siglip2";
    const dir = path.join(MODELS, model);
    if (!existsSync(dir)) continue;
    const prompts = strings(c.input.prompts);
    const want = i64(c.output.input_ids);
    const { ids, len } = tagger.tokenizePrompts(model, dir, prompts);
    const got = Array.from(ids, Number);
    let bad = 0;
    for (let i = 0; i < prompts.length; i++) if (!same(got.slice(i * len, (i + 1) * len), want.slice(i * len, (i + 1) * len))) bad++;
    const extra = strings(c.input.extra_texts);
    const wantX = i64(c.output.extra_ids);
    const gx = Array.from(tagger.tokenizePrompts(model, dir, extra).ids, Number);
    let badX = 0;
    for (let i = 0; i < extra.length; i++) if (!same(gx.slice(i * len, (i + 1) * len), wantX.slice(i * len, (i + 1) * len))) badX++;
    check(bad === 0 && badX === 0, `tags text ${model}: ${bad} prompts + ${badX} edge cases tokenised differently`);
    summary.push(`tags text ${model}: ${prompts.length - bad}/${prompts.length} prompts + ${extra.length - badX}/${extra.length} edge cases tokenised identically`);
    if (model === "siglip2" && !process.env.LP_ML_SLOW_TESTS) {
      summary.push("tags text siglip2 tag embeddings: skipped (LP_ML_SLOW_TESTS=1 runs the 1.1 GB text tower)");
      continue;
    }
    const wantE = f32(c.output.tag_embeddings);
    const started = performance.now();
    const { dim, data } = await tagger.buildTagEmbeddings(model, dir, tagger.TAGS);
    let worst = 1;
    for (let i = 0; i < data.length / dim; i++) worst = Math.min(worst, cosine(data.subarray(i * dim, (i + 1) * dim), wantE.subarray(i * dim, (i + 1) * dim)));
    check(worst > 0.9999, `tags text ${model}: tag embeddings min cosine ${worst}`);
    summary.push(
      `tags text ${model}: ${data.length / dim} tag embeddings rebuilt in ${((performance.now() - started) / 1000).toFixed(1)} s, min cosine ${worst.toFixed(7)}, max diff ${maxAbsDiff(data, wantE).toExponential(2)}`,
    );
  }
}

class Parity {
  images = 0;
  sameTags = 0;
  sameOrder = 0;
  maxScore = 0;
  minCos = 1;
  mismatches: string[] = [];
  record(id: string, ours: Awaited<ReturnType<InstanceType<typeof tagger.Tagger>["predict"]>>, want: any) {
    const wt = strings(want.tags.tags);
    const a = [...ours.tags].sort();
    const b = [...wt].sort();
    this.images++;
    this.sameTags += same(a, b) ? 1 : 0;
    this.sameOrder += same(ours.tags, wt) ? 1 : 0;
    this.maxScore = Math.max(this.maxScore, maxAbsDiff(ours.scores, f32(want.scores)));
    if (want.embedding) this.minCos = Math.min(this.minCos, cosine(ours.embedding, f32(want.embedding)));
    if (!same(a, b)) this.mismatches.push(`${id}: ours ${JSON.stringify(ours.tags)} python ${JSON.stringify(wt)}`);
  }
  report(model: string, what: string) {
    summary.push(
      `tags ${model} [${what}]: ${this.sameTags}/${this.images} same tag set, ${this.sameOrder}/${this.images} same order, max score diff ${this.maxScore.toExponential(2)}, min embedding cosine ${this.minCos.toFixed(6)}`,
    );
    for (const m of this.mismatches) summary.push(`    ${m}`);
  }
}

async function tagsImages(model: "mobileclip_s2" | "siglip2") {
  const g = await load("tags", model);
  const dir = modelDir(model);
  if (!g || !dir) return;
  const t = await tagger.Tagger.load(model, dir);
  const pixels = new Parity(),
    files = new Parity(),
    jpegs = new Parity();
  let total = 0,
    timed = 0;
  for (const c of g.cases) {
    const p = c.input.image as string;
    if (!existsSync(p)) continue;
    const started = performance.now();
    let ours: Awaited<ReturnType<typeof t.predict>> | Error;
    try {
      ours = await t.predict(p);
    } catch (e) {
      ours = e as Error;
    }
    total += performance.now() - started;
    timed++;
    if (c.output.error !== undefined) {
      check(ours instanceof Error, `tags ${model} ${c.id}: Python failed, TS did not`);
      continue;
    }
    if (ours instanceof Error) {
      check(false, `tags ${model} ${c.id}: ${ours.message}`);
      continue;
    }
    files.record(c.id, ours, c.output);
    if (!/\.jpe?g$/i.test(p)) {
      pixels.record(c.id, ours, c.output);
      continue;
    }
    jpegs.record(c.id, ours, c.output);
    const decoded = path.join(GOLDENS, "_decoded", "tags", `${c.id.replaceAll("/", "__")}.png`);
    if (existsSync(decoded)) pixels.record(c.id, await t.predict(decoded), c.output);
  }
  await t.release();
  pixels.report(model, "same pixels");
  files.report(model, "files as is");
  jpegs.report(model, "jpeg files only");
  summary.push(`tags ${model}: ${(total / Math.max(timed, 1)).toFixed(0)} ms per image (decode + model, ${process.env.ONNX_INTRA_OP_THREADS ?? "default"} threads)`);
  check(pixels.images > 0, `tags ${model}: no images`);
  check(pixels.sameTags * 100 >= pixels.images * 99, `tags ${model}: tag sets differ on too many images`);
  check(pixels.maxScore <= 1e-3, `tags ${model}: scores differ by ${pixels.maxScore}`);
  check(files.sameTags * 100 >= files.images * 95, `tags ${model}: tag sets of the files as is differ on too many images`);
}

async function tagsEdge() {
  const g = await load("tags", "edge");
  if (!g) return;
  const INEXACT = ["rgb16.png", "gray16.png"];
  for (const model of ["mobileclip_s2", "siglip2"] as const) {
    const dir = modelDir(model);
    if (!dir) continue;
    const t = await tagger.Tagger.load(model, dir);
    let checked = 0,
      fileSame = 0,
      fileChecked = 0;
    for (const c of g.cases.filter((x) => x.input.model === model)) {
      const p = c.input.image as string;
      if (!existsSync(p)) continue;
      const name = path.basename(p);
      let ours: Awaited<ReturnType<typeof t.predict>> | Error;
      try {
        ours = await t.predict(p);
      } catch (e) {
        ours = e as Error;
      }
      if (c.output.error !== undefined) {
        check(ours instanceof Error, `tags edge ${model} ${name}: Python failed, TS did not`);
        checked++;
        continue;
      }
      if (ours instanceof Error) {
        check(false, `tags edge ${model} ${name}: ${ours.message}`);
        continue;
      }
      const want = strings(c.output.tags.tags);
      const onPixels = await t.predict(c.input.decoded);
      check(same(onPixels.tags, want), `tags edge ${model} ${name}: tags ${JSON.stringify(onPixels.tags)} vs ${JSON.stringify(want)}`);
      const diff = maxAbsDiff(onPixels.scores, f32(c.output.scores));
      check(diff <= 1e-4, `tags edge ${model} ${name}: scores differ by ${diff}`);
      if (!name.endsWith(".jpg") && !INEXACT.includes(name)) {
        const a = await pre.loadRgb(p);
        const b = await pre.loadRgb(c.input.decoded);
        const [max] = u8Diff(a.data, b.data);
        check(a.width === b.width && a.height === b.height && max === 0, `tags edge ${name}: pixels differ from Pillow's (max ${max})`);
        check(same(ours.tags, want), `tags edge ${model} ${name}: file tags ${JSON.stringify(ours.tags)} vs ${JSON.stringify(want)}`);
      }
      fileChecked++;
      fileSame += same(ours.tags, want) ? 1 : 0;
      checked++;
    }
    await t.release();
    summary.push(`tags edge ${model}: ${checked} cases checked (errors where Python errs; Pillow's pixels give identical tags), files as is ${fileSame}/${fileChecked} identical`);
    check(checked > 0, `tags edge ${model}: nothing checked`);
  }
}

async function tagsFresh() {
  const g = await load("tags", "text_fresh");
  if (!g) return;
  for (const c of g.cases) {
    const model = c.id as "mobileclip_s2" | "siglip2";
    if (model === "siglip2" && !process.env.LP_ML_SLOW_TESTS) {
      summary.push("tags fresh siglip2: skipped (LP_ML_SLOW_TESTS=1)");
      continue;
    }
    const dir = modelDir(model);
    if (!dir) continue;
    const tags = (c.input.indices as number[]).map((i) => tagger.TAGS[i]);
    const want = f32(c.output.embeddings);
    const { dim, data } = await tagger.buildTagEmbeddings(model, dir, tags);
    let worst = 1;
    for (let i = 0; i < tags.length; i++) worst = Math.min(worst, cosine(data.subarray(i * dim, (i + 1) * dim), want.subarray(i * dim, (i + 1) * dim)));
    const diff = maxAbsDiff(data, want);
    check(worst > 0.99999 && diff < 1e-4, `tags fresh ${model}: min cosine ${worst}, max diff ${diff}`);
    summary.push(`tags fresh ${model}: ${tags.length} prompts (non-ASCII incl.), min cosine ${worst.toFixed(7)}, max diff ${diff.toExponential(2)}`);
  }
}

// ------------------------------------------------------------- similarity

async function similarity() {
  const g = await load("similarity", "search");
  if (!g) return;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lp-sim-"));
  try {
    const user = g.meta.user_id as number;
    const hashes = g.meta.hashes as string[];
    const flat = f32(g.meta.embeddings);
    const embs = Array.from({ length: hashes.length }, (_, i) => flat.slice(i * 512, (i + 1) * 512));
    let store = new SimilarityStore(tmp);
    const page = 250;
    const pages = Math.max(1, Math.ceil(hashes.length / page));
    let size = 0;
    for (let p = 0; p < pages; p++) {
      const r = await store.build({
        user_id: user,
        image_hashes: hashes.slice(p * page, (p + 1) * page),
        image_embeddings: embs.slice(p * page, (p + 1) * page),
        begin: p === 0,
        commit: p + 1 === pages,
      });
      size = r.index_size;
    }
    check(size === hashes.length, `similarity: index size ${size}`);
    let checked = 0,
      off = 0;
    for (const c of g.cases.filter((x) => x.output.faiss_ids)) {
      const q = f32(c.input.embedding);
      const ids = i64(c.output.faiss_ids);
      const dist = f32(c.output.faiss_dist);
      ids.forEach((id, k) => {
        checked++;
        if (Math.fround(dot(embs[id], 0, q)) !== dist[k]) off++;
      });
    }
    check(off === 0, `similarity: ${off} inner products not bit-identical to FAISS`);
    // A fresh store reads the index back from disk.
    store = new SimilarityStore(tmp);
    let hits = 0;
    const mismatched: string[] = [];
    for (const c of g.cases) {
      const got = store.search(user, f32(c.input.embedding), c.input.n ?? null, c.input.threshold);
      const want = c.output.result as string[];
      hits += want.length;
      if (!same(got, want)) mismatched.push(c.id);
    }
    check(!mismatched.length, `similarity: searches differ: ${mismatched.slice(0, 10).join(", ")}`);
    summary.push(
      `similarity: ${checked} inner products, ${off} not bit-identical to FAISS; ${g.cases.length} searches (${hits} hits), ${mismatched.length} differ from RetrievalIndex.search_similar`,
    );

    // The paged-rebuild contract (lp-ml tests/similarity.rs).
    const vec = (seed: number, i: number) => Float32Array.from({ length: 512 }, (_, j) => (((i * 31 + j * 7) ^ seed) % 97) / 10);
    const mk = (n: number, seed: number) => ({
      h: Array.from({ length: n }, (_, i) => `${seed}-${String(i).padStart(5, "0")}`),
      e: Array.from({ length: n }, (_, i) => vec(seed, i)),
    });
    const q = new Float32Array(512).fill(1);
    const s2 = new SimilarityStore(path.join(tmp, "contract"));
    check(s2.search(3, q, null, 0).length === 0, "contract: no index = no hits");
    const a = mk(12, 1);
    for (let p = 0; p < 3; p++) {
      await s2.build({ user_id: 3, image_hashes: a.h.slice(p * 5, p * 5 + 5), image_embeddings: a.e.slice(p * 5, p * 5 + 5), begin: p === 0, commit: p === 2 });
    }
    check(s2.storedLen(3) === 12, "contract: stored 12");
    check(s2.search(3, q, 4, 0).length === 4, "contract: n = 4");
    const b = mk(2, 9);
    check((await s2.build({ user_id: 3, image_hashes: b.h, image_embeddings: b.e, begin: false, commit: false })).index_size === 14, "contract: incremental add");
    check((await s2.build({ user_id: 3, image_hashes: a.h.slice(0, 3), image_embeddings: a.e.slice(0, 3), begin: true, commit: false })).index_size === 3, "contract: staged");
    check(s2.storedLen(3) === 14, "contract: live index untouched while staged");
    let err = await s2
      .build({ user_id: 3, image_hashes: a.h.slice(0, 1), image_embeddings: [new Float32Array(7)], begin: false, commit: true })
      .then(() => null, (e) => e as { status: number; message: string });
    check(err?.status === 400 && err.message.includes("abandoned"), `contract: bad page abandons (${err?.message})`);
    err = await s2.build({ user_id: 3, image_hashes: [], image_embeddings: [], begin: false, commit: true }).then(() => null, (e) => e);
    check(!!err?.message.includes("no rebuild in progress"), "contract: commit without rebuild refused");
    check(s2.search(3, q, null, 0).length === 14, "contract: old index kept");
    await s2.build({ user_id: 3, image_hashes: [], image_embeddings: [], begin: true, commit: true });
    check(s2.search(3, q, null, 0).length === 0, "contract: empty rebuild empties");
    const other = new SimilarityStore(path.join(tmp, "contract"));
    await Bun.sleep(20);
    await other.build({ user_id: 3, image_hashes: a.h, image_embeddings: a.e, begin: true, commit: true });
    check(s2.search(3, q, null, 0).length === 12, "contract: another process's rebuild is picked up");
    let threw = false;
    try {
      s2.search(3, q.subarray(0, 10), null, 0);
    } catch (e) {
      threw = (e as { status?: number }).status === 500;
    }
    check(threw, "contract: wrong query size is a 500");
    await s2.delete(3);
    check(s2.storedLen(3) === null && s2.search(3, q, null, 0).length === 0, "contract: delete");
    await s2.delete(3);
    summary.push("similarity: paged-rebuild / incremental / abandon / delete / cross-process contract ok");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const SECTIONS: Record<string, () => Promise<void>> = {
  preprocess,
  tokenize,
  clip_text: clipText,
  clip_images: () => clipImages("images"),
  clip_edge: () => clipImages("edge"),
  tags_text: tagsText,
  tags_mobileclip: () => tagsImages("mobileclip_s2"),
  tags_siglip2: () => tagsImages("siglip2"),
  tags_edge: tagsEdge,
  tags_fresh: tagsFresh,
  similarity,
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SECTIONS);
const t0 = performance.now();
for (const s of wanted) {
  const run = SECTIONS[s];
  if (!run) throw new Error(`unknown section ${s}`);
  const started = performance.now();
  console.log(`== ${s}`);
  try {
    await run();
  } catch (e) {
    failures.push(`${s}: ${(e as Error).stack ?? e}`);
  }
  console.log(`   ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
console.log("\n" + summary.join("\n"));
console.log(`\n${failures.length ? `FAILED (${failures.length})` : "ALL PASSED"} in ${((performance.now() - t0) / 1000).toFixed(0)} s, RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
for (const f of failures.slice(0, 60)) console.log(`  x ${f}`);
process.exit(failures.length ? 1 : 0);
