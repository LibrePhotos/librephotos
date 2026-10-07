// Golden parity of the in-process captioner (src/ml/caption, LFM2.5-VL-450M)
// against the Python reference outputs (apps/backend-rs/tests/ml
// golden_caption.py / golden_caption_edge.py / golden_preprocess.py), with
// the tolerances of librephotos-rs's crates/lp-ml/tests/caption.rs.
//
//   ONNX_INTRA_OP_THREADS=4 bun run scripts/ml_goldens_caption.ts [section...]
//
// Sections: unit tokenize prepare prepare_edge captions (default: all).
// LP_CAPTION_GOLDEN_LIMIT=n runs the first n caption cases (default: all 64).
// LP_ML_GOLDENS (default <librephotos>/rust-pg/ml-goldens) and LP_DATA_MODELS
// (default <librephotos>/rust-pg/ml/protected_media/data_models).
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const GOLDENS = process.env.LP_ML_GOLDENS ?? path.join(ROOT, "rust-pg", "ml-goldens");
process.env.LP_DATA_MODELS ??= path.join(ROOT, "rust-pg", "ml", "protected_media", "data_models");
const MODELS = process.env.LP_DATA_MODELS;

const lfm = await import("../src/ml/caption/lfm2_vl");
const { Lfm2Tokenizer } = await import("../src/ml/caption/tokenizer");
const pre = await import("../src/ml/preprocess");

interface Case {
  id: string;
  input: Record<string, any>;
  output: Record<string, any>;
}
interface Golden {
  meta: Record<string, any>;
  cases: Case[];
}
interface Arr {
  dtype: string;
  shape: number[];
  b64: string;
}

async function load(service: string, name: string): Promise<Golden | null> {
  const p = path.join(GOLDENS, service, `${name}.json`);
  if (!existsSync(p)) {
    console.log(`  golden ${p} missing, skipping`);
    return null;
  }
  return (await Bun.file(p).json()) as Golden;
}

const bytesOf = (a: Arr) => new Uint8Array(Buffer.from(a.b64, "base64"));
function f32(a: Arr): Float32Array {
  const b = bytesOf(a);
  if (a.dtype === "float32") return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (a.dtype === "float64") return Float32Array.from(new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8));
  throw new Error(`not a float array: ${a.dtype}`);
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
const isJpeg = (p: string) => /\.jpe?g$/i.test(p);
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

let failures = 0;
function check(ok: boolean, what: string) {
  if (!ok) {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

async function unit() {
  console.log("unit");
  const cases: [[number, number], [number, number]][] = [
    [[480, 640], [416, 576]],
    [[1, 1], [256, 256]],
    [[90, 1600], [96, 1600]],
    [[768, 1024], [416, 576]],
    [[260, 900], [256, 896]],
    [[517, 333], [512, 320]],
    [[4000, 3000], [576, 416]],
    [[100, 5000], [64, 3616]],
  ];
  for (const [[h, w], want] of cases) check(same(lfm.smartResize(h, w), want), `smart_resize ${h}x${w} = ${lfm.smartResize(h, w)}, want ${want}`);
  const clean: [string, string][] = [
    ['  "A dog." \n', "A dog."],
    ["'A cat'", "A cat"],
    ['"A "quoted" word', '"A "quoted" word'],
    ['"', '"'],
    ['""', ""],
    ["\x1cA\x1f", "A"],
  ];
  for (const [i, o] of clean) check(lfm.cleanCaption(i) === o, `clean_caption ${JSON.stringify(i)} = ${JSON.stringify(lfm.cleanCaption(i))}`);
  check(lfm.f16ToF32(0x3c00) === 1, "f16 1.0");
  check(lfm.f16ToF32(0xc000) === -2, "f16 -2.0");
  check(lfm.f16ToF32(0x7bff) === 65504, "f16 max");
  check(lfm.f16ToF32(0x0001) === Math.fround(5.9604645e-8), "f16 subnormal");
  check(lfm.f16ToF32(0xfc00) === -Infinity, "f16 -inf");
  check(Number.isNaN(lfm.f16ToF32(0x7e00)), "f16 nan");
  check(lfm.argmax([1, 3, 3, 2]) === 1, "argmax first max");
  console.log(`  ok (${failures} failures so far)`);
}

async function tokenize() {
  console.log("tokenize (preprocess/tokenize.json, lfm2_vl_450m cases)");
  const g = await load("preprocess", "tokenize");
  if (!g) return;
  const toks = new Map<string, InstanceType<typeof Lfm2Tokenizer>>();
  let n = 0;
  for (const c of g.cases) {
    if (c.input.model !== lfm.MODEL_NAME) continue;
    const file = path.join(MODELS, lfm.MODEL_NAME, "tokenizer.json");
    if (!toks.has(file)) toks.set(file, Lfm2Tokenizer.load(file));
    const ids = toks.get(file)!.encode(c.input.text, true);
    check(same(ids, c.output.ids), `${c.id}: ${JSON.stringify(ids)} vs ${JSON.stringify(c.output.ids)}`);
    n++;
  }
  // Round trips through the decoder, incl. non-Latin text and the added (non-special) tokens.
  const tok = Lfm2Tokenizer.load(path.join(MODELS, lfm.MODEL_NAME, "tokenizer.json"));
  for (const t of ["Sonnenuntergang über den Bergen", "東京タワー at night — 🎉", "Mathias writes python", "a\r\n\n  b\t"]) {
    const back = tok.decode(tok.encode(t, true), true);
    check(back === t, `round trip ${JSON.stringify(t)} -> ${JSON.stringify(back)}`);
  }
  console.log(`  ${n} cases`);
}

async function prepare() {
  console.log("prepare (caption/lfm2_vl.json: resize, spatial shapes, image tokens, pixel sum)");
  const g = await load("caption", "lfm2_vl");
  if (!g) return;
  let maxRel = 0;
  for (const c of g.cases) {
    const p = c.input.image as string;
    const patches = lfm.prepareImage(await pre.loadRgb(p));
    check(same(patches.resized, c.output.resized), `${c.id}: resized ${patches.resized} vs ${c.output.resized}`);
    check(same([patches.patchesH, patches.patchesW], c.output.spatial_shapes), `${c.id}: spatial ${[patches.patchesH, patches.patchesW]}`);
    check(lfm.imageTokens(patches) === c.output.image_tokens, `${c.id}: image tokens`);
    let sum = 0;
    for (const v of patches.pixelValues) sum += v;
    const tol = isJpeg(p) ? 2e-2 * patches.pixelValues.length : 1e-3;
    const d = Math.abs(sum - c.output.pixel_sum);
    if (!isJpeg(p)) maxRel = Math.max(maxRel, d);
    check(d <= tol, `${c.id}: pixel sum ${sum} vs ${c.output.pixel_sum}`);
  }
  console.log(`  ${g.cases.length} cases, lossless max |pixel sum diff| ${maxRel}`);
}

async function prepareEdge() {
  console.log("prepare_edge (caption/prepare_edge.json: decoded RGB + patch tensor)");
  const g = await load("caption", "prepare_edge");
  if (!g) return;
  for (const c of g.cases) {
    const p = c.input.image as string;
    let img;
    try {
      img = await pre.loadRgb(p);
    } catch (e) {
      check(false, `${c.id}: load failed: ${(e as Error).message}`);
      continue;
    }
    const rgb = c.output.rgb as Arr;
    const [h, w] = rgb.shape;
    if (img.width !== w || img.height !== h) {
      check(false, `${c.id}: decoded ${img.width}x${img.height}, Pillow ${w}x${h}`);
      continue;
    }
    const want = bytesOf(rgb);
    let dmax = 0,
      dn = 0;
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(img.data[i] - want[i]);
      if (d) dn++;
      dmax = Math.max(dmax, d);
    }
    const patches = lfm.prepareImage(img);
    const wantPv = f32(c.output.pixel_values);
    const pmax = patches.pixelValues.length === wantPv.length ? maxAbsDiff(patches.pixelValues, wantPv) : Infinity;
    const line = `${c.id} (${c.output.mode}): rgb max diff ${dmax} (${dn} bytes), pixel_values max diff ${pmax}`;
    console.log(`  ${line}`);
    if (isJpeg(p)) check(dmax <= 8 && pmax !== Infinity, line);
    else check(dn === 0 && pmax === 0, line);
  }
}

async function captions() {
  const g = await load("caption", "lfm2_vl");
  if (!g) return;
  const dir = path.join(MODELS, lfm.MODEL_NAME);
  if (!lfm.Lfm2Vl.modelFiles(dir).every(existsSync)) {
    console.log(`  ${dir} incomplete, skipping`);
    return;
  }
  const limit = Number(process.env.LP_CAPTION_GOLDEN_LIMIT ?? g.cases.length);
  const cases = g.cases.slice(0, limit);
  console.log(`captions (caption/lfm2_vl.json, ${cases.length} of ${g.cases.length} cases)`);
  const t = performance.now();
  const m = await lfm.Lfm2Vl.load(dir);
  console.log(`  loaded in ${((performance.now() - t) / 1000).toFixed(2)}s (python ${Number(g.meta.load_seconds).toFixed(2)}s), cache ${m.cacheDtype}`);
  let sameIds = 0,
    sameCaption = 0,
    exact = 0,
    exactSame = 0;
  let totalMs = 0,
    decodeMs = 0,
    decodeSteps = 0,
    prefillMs = 0,
    tokens = 0;
  const report: string[] = [];
  for (const c of cases) {
    const p = c.input.image as string;
    const prompt = (c.input.prompt as string | null) ?? lfm.DEFAULT_PROMPT;
    const img = await pre.loadRgb(p);
    const t0 = performance.now();
    const patches = lfm.prepareImage(img);
    if (c.output.image_features) {
      const want = c.output.image_features as Arr;
      const got = await m.imageFeatures(patches);
      check(same(got.dims, want.shape), `${c.id}: features shape ${got.dims} vs ${want.shape}`);
      const cos = cosine(got.data, f32(want));
      check(cos >= (isJpeg(p) ? 0.99 : 0.9999), `${c.id}: features cosine ${cos}`);
    }
    const t1 = performance.now();
    const got = await m.generatePatches(patches, prompt, lfm.DEFAULT_MAX_NEW_TOKENS);
    const ms = performance.now() - t1;
    totalMs += ms;
    prefillMs += got.prefillMs;
    decodeMs += got.decodeMs;
    // The steps after the prefill: one per generated token (the last emits <|im_end|> unless the 64 cap hit).
    decodeSteps += got.tokenIds.length < lfm.DEFAULT_MAX_NEW_TOKENS ? got.tokenIds.length : got.tokenIds.length - 1;
    tokens += got.tokenIds.length;
    check(same(got.promptIds, c.output.prompt_ids), `${c.id}: prompt ids differ`);
    const wantIds = c.output.token_ids as number[];
    const wantCaption = c.output.caption as string;
    const lossless = !isJpeg(p);
    if (lossless) exact++;
    if (same(got.tokenIds, wantIds)) {
      sameIds++;
      if (lossless) exactSame++;
      check(got.caption === wantCaption, `${c.id}: same ids, different text: ${JSON.stringify(got.caption)} vs ${JSON.stringify(wantCaption)}`);
    } else {
      let at = 0;
      while (got.tokenIds[at] === wantIds[at]) at++;
      const margin = (c.output.margins as number[] | undefined)?.[at];
      report.push(
        `${c.id} (${lossless ? "exact decode" : "jpeg"}): diverges at token ${at} (python top-2 margin ${margin})\n    ts:     ${got.caption}\n    python: ${wantCaption}`,
      );
      if (lossless) check(false, `${c.id}: lossless input, token sequence differs`);
    }
    if (got.caption === wantCaption) sameCaption++;
    console.log(`  ${(ms / 1000).toFixed(2)}s ${String(got.tokenIds.length).padStart(3)} tok (prep ${(t1 - t0).toFixed(0)} ms) ${c.id}: ${got.caption}`);
  }
  const n = cases.length;
  console.log(
    `\n  parity: identical token sequences ${sameIds}/${n} (${((100 * sameIds) / n).toFixed(1)}%), identical captions ${sameCaption}/${n}; exact-decode inputs ${exactSame}/${exact}`,
  );
  console.log(
    `  mean ms per caption ${(totalMs / n).toFixed(0)} (python ${((1000 * cases.reduce((s, c) => s + Number(c.output.seconds ?? 0), 0)) / n).toFixed(0)} when the goldens were made); ` +
      `decoder prefill ${(prefillMs / n).toFixed(0)} ms; decode ${(decodeMs / Math.max(1, decodeSteps)).toFixed(1)} ms/token over ${decodeSteps} steps (${tokens} tokens)`,
  );
  for (const r of report) console.log(`  ${r}`);
  check(sameIds >= 0.9 * n, `only ${sameIds}/${n} captions have Python's token sequence`);
  await m.release();
}

const sections: Record<string, () => Promise<void>> = { unit, tokenize, prepare, prepare_edge: prepareEdge, captions };
const want = process.argv.slice(2);
for (const name of want.length ? want : Object.keys(sections)) {
  const f = sections[name];
  if (!f) throw new Error(`unknown section ${name}`);
  await f();
}
console.log(failures ? `\n${failures} FAILURES` : "\nall caption goldens pass");
process.exit(failures ? 1 : 0);
