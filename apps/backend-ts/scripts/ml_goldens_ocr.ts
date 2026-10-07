// Golden parity of the in-process OCR port (src/ml/ocr) and the cv2
// resizes it uses (src/ml/preprocess/cv2.ts) against the Python reference
// outputs (apps/backend-rs/tests/ml/golden_ocr.py), with the tolerances of
// librephotos-rs's crates/lp-ml/tests/ocr.rs and preprocess_goldens.rs.
//
//   ONNX_INTRA_OP_THREADS=4 bun run scripts/ml_goldens_ocr.ts [section...]
//
// Sections: cv2 resize geometry units edge_tiny edge_medium inprocess
// pipeline_tiny pipeline_small (default: all). LP_ML_GOLDENS (default
// <librephotos>/rust-pg/ml-goldens) and LP_DATA_MODELS (default
// <librephotos>/rust-pg/ml/protected_media/data_models).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const GOLDENS = process.env.LP_ML_GOLDENS ?? path.join(ROOT, "rust-pg", "ml-goldens");
process.env.LP_DATA_MODELS ??= path.join(ROOT, "rust-pg", "ml", "protected_media", "data_models");
const MODELS = process.env.LP_DATA_MODELS;

const cv2 = await import("../src/ml/preprocess/cv2");
const pre = await import("../src/ml/preprocess");
const { findContours } = await import("../src/ml/ocr/contours");
const hull = await import("../src/ml/ocr/hull");
const poly = await import("../src/ml/ocr/poly");
const warp = await import("../src/ml/ocr/warp");
const ppocr = await import("../src/ml/ocr/ppocr");
const { readImage } = await import("../src/ml/ocr/decode");
const { loadCharset } = await import("../src/ml/ocr/config");

type Image3 = import("../src/ml/ocr/warp").Image3;
type IntQuad = import("../src/ml/ocr/poly").IntQuad;

interface Arr {
  dtype: string;
  shape: number[];
  b64: string;
}
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

const bytesOf = (a: Arr) => new Uint8Array(Buffer.from(a.b64, "base64"));
function f32(a: Arr): Float32Array {
  const b = bytesOf(a);
  const c = new Uint8Array(b); // aligned copy
  if (a.dtype === "float32") return new Float32Array(c.buffer, 0, c.byteLength / 4);
  if (a.dtype === "float64") return Float32Array.from(new Float64Array(c.buffer, 0, c.byteLength / 8));
  throw new Error(`not a float array: ${a.dtype}`);
}
function ints(a: Arr): number[] {
  const c = new Uint8Array(bytesOf(a));
  if (a.dtype === "int64") return Array.from(new BigInt64Array(c.buffer, 0, c.byteLength / 8), Number);
  if (a.dtype === "int32") return Array.from(new Int32Array(c.buffer, 0, c.byteLength / 4));
  throw new Error(`not an int array: ${a.dtype}`);
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
function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** The pipeline keeps RGB; the goldens hash cv2's BGR. */
function bgr(img: Image3): Uint8Array {
  const out = img.data.slice();
  for (let i = 0; i < out.length; i += 3) {
    out[i] = img.data[i + 2];
    out[i + 2] = img.data[i];
  }
  return out;
}
const image3 = (a: Arr): Image3 => ({ w: a.shape[1], h: a.shape[0], data: bytesOf(a) });
const quad4 = (v: Float32Array): [number, number][] => [
  [v[0], v[1]],
  [v[2], v[3]],
  [v[4], v[5]],
  [v[6], v[7]],
];
const pairs = (v: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]);
  return out;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function iou(a: number[], b: number[]): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua <= 0 ? 0 : inter / ua;
}
const bbox = (q: IntQuad) => {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const lines = (t: string) => t.split("\n").filter((l) => l !== "");

const failures: string[] = [];
const summary: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

// ------------------------------------------------------------- cv2 (preprocess goldens)

async function cv2Section() {
  const g = await load("preprocess", "resize");
  if (!g) return;
  const t = new Map<string, { cases: number; exact: number; max: number }>();
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
    rec("cv2_linear_odd", cv2.resizeLinear(data, w, h, 3, ow, oh), bytesOf(o.cv2_linear_odd));
    rec("cv2_area_odd", cv2.resizeArea(data, w, h, 3, ow, oh), bytesOf(o.cv2_area_odd));
    const cw = Math.min(w, 50);
    const ch = Math.min(h, 40);
    const sub = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) sub.set(data.subarray(y * w * 3, (y * w + cw) * 3), y * cw * 3);
    const [uw, uh] = c.input.up;
    rec("cv2_linear_up", cv2.resizeLinear(sub, cw, ch, 3, uw, uh), bytesOf(o.cv2_linear_up));
    if (o.cv2_linear_half) {
      const hw = Math.floor(w / 2);
      const hh = Math.floor(h / 2);
      const even = new Uint8Array(hw * 2 * hh * 2 * 3);
      for (let y = 0; y < hh * 2; y++) even.set(data.subarray(y * w * 3, (y * w + hw * 2) * 3), y * hw * 2 * 3);
      rec("cv2_linear_half", cv2.resizeLinear(even, hw * 2, hh * 2, 3, hw, hh), bytesOf(o.cv2_linear_half));
    }
  }
  for (const [k, v] of t) {
    summary.push(`preprocess ${k}: ${v.exact}/${v.cases} bit-exact (max diff ${v.max})`);
    check(v.max === 0, `preprocess ${k}: max diff ${v.max}`);
  }
}

// ------------------------------------------------------------- ocr/resize

async function resizeSection() {
  const g = await load("ocr", "resize");
  if (!g) return;
  let ok = 0;
  for (const c of g.cases) {
    const src = c.input.image as Arr;
    const [h, w] = src.shape;
    const [dw, dh] = c.input.size;
    const ours = c.input.interp === "area" ? cv2.resizeArea(bytesOf(src), w, h, 3, dw, dh) : cv2.resizeLinear(bytesOf(src), w, h, 3, dw, dh);
    const [, n] = u8Diff(ours, bytesOf(c.output.image));
    if (n === 0) ok++;
    else failures.push(`ocr resize ${c.id}: ${w}x${h} -> ${dw}x${dh} (${c.input.interp}): ${n} samples differ`);
  }
  summary.push(`ocr cv2.resize (INTER_LINEAR / INTER_AREA, seeded sizes): ${ok}/${g.cases.length} exact`);
}

// ------------------------------------------------------------- ocr/geometry

async function geometrySection() {
  const g = await load("ocr", "geometry");
  if (!g) return;
  let contourSets = 0,
    minis = 0,
    scores = 0,
    unclips = 0,
    crops = 0,
    norms = 0;
  const fails: string[] = [];
  for (const c of g.cases) {
    switch (c.input.kind) {
      case "contours": {
        const bm = c.input.bitmap as Arr;
        const [h, w] = bm.shape;
        const ours = findContours(bytesOf(bm), w, h);
        const want = (c.output.contours as Arr[]).map(ints);
        if (!same(ours, want)) {
          fails.push(`${c.id}: contours differ (${ours.length} vs ${want.length})`);
          continue;
        }
        contourSets++;
        ours.forEach((contour, i) => {
          const m = c.output.mini[i];
          const [q, s] = hull.getMiniBoxes({ int: true, xy: contour });
          const wq = quad4(f32(m.box));
          const ws = Math.fround(m.sside);
          if (!same(q, wq) || s !== ws) fails.push(`${c.id}: mini box ${JSON.stringify(q)}/${s} vs ${JSON.stringify(wq)}/${ws}; rect ${JSON.stringify(m.rect)}`);
          else minis++;
        });
        break;
      }
      case "score": {
        const prob = c.input.prob as Arr;
        const s = poly.boxScoreFast(f32(prob), prob.shape[1], prob.shape[0], quad4(f32(c.input.box)));
        if (s !== c.output.score) fails.push(`${c.id}: score ${s} vs ${c.output.score}`);
        else scores++;
        break;
      }
      case "unclip": {
        const quad = quad4(f32(c.input.box));
        const ours = poly.unclip(quad, 1.4);
        const want = c.output.expanded && typeof c.output.expanded === "object" ? pairs(ints(c.output.expanded)) : null;
        if (!same(ours, want)) {
          fails.push(`${c.id}: unclip ${JSON.stringify(ours)} vs ${JSON.stringify(want)}`);
          continue;
        }
        if (!ours || ours.length < 4) {
          unclips++;
          continue;
        }
        const xy: number[] = [];
        for (const p of ours) xy.push(Math.fround(p[0]), Math.fround(p[1]));
        const [q, s] = hull.getMiniBoxes({ int: false, xy });
        const wq = quad4(f32(c.output.mini));
        const ws = Math.fround(c.output.sside);
        const ordered = poly.orderPointsClockwise(q);
        const wo = quad4(f32(c.output.ordered));
        const dest = c.output.dest as [number, number];
        const rescaled = poly.rescaleQuad(ordered, [448, 320], dest);
        const wr = pairs(ints(c.output.rescaled));
        if (!same(q, wq) || s !== ws || !same(ordered, wo) || !same(rescaled, wr)) {
          fails.push(
            `${c.id}: mini ${JSON.stringify(q)}/${s} vs ${JSON.stringify(wq)}/${ws}, ordered ${JSON.stringify(ordered)} vs ${JSON.stringify(wo)}, rescaled ${JSON.stringify(rescaled)} vs ${JSON.stringify(wr)}`,
          );
        } else unclips++;
        break;
      }
      case "crop": {
        const img = image3(c.input.image);
        const q = pairs(ints(c.input.box));
        const ours = warp.rotateCrop(img, q);
        const want = c.output.crop as Arr;
        const [maxd, n] = ours.w === want.shape[1] && ours.h === want.shape[0] ? u8Diff(ours.data, bytesOf(want)) : [255, -1];
        if (n !== 0) fails.push(`${c.id}: crop ${ours.w}x${ours.h} vs ${JSON.stringify(want.shape)}: ${n} values differ, max ${maxd}`);
        else crops++;
        break;
      }
      case "recnorm": {
        // the pipeline keeps RGB; the golden holds cv2's BGR
        const img = image3(c.input.image);
        img.data = bgr(img);
        const ours = ppocr.resizeNormImg(img, [3, 48, 320]);
        const d = maxAbsDiff(ours, f32(c.output.tensor));
        if (d !== 0) fails.push(`${c.id}: rec tensor max diff ${d}`);
        else norms++;
        break;
      }
      default:
        throw new Error(`unknown case kind ${c.input.kind}`);
    }
  }
  summary.push(
    `ocr geometry: contour sets ${contourSets}, mini boxes ${minis}, scores ${scores}, unclips ${unclips}, crops ${crops}, rec tensors ${norms}; ${fails.length} mismatches`,
  );
  for (const f of fails.slice(0, 20)) console.log(`  ${f}`);
  check(fails.length === 0, `ocr geometry: ${fails.length} mismatches`);
}

// ------------------------------------------------------------- unit checks

function unitSection() {
  check(same(loadCharset("a\n \nb\n"), ["a", " ", "b"]), "charset: spaces");
  check(same(loadCharset("a\r\nb"), ["a", "b"]), "charset: CRLF");
  check(same(loadCharset("a\n\n"), ["a"]), "charset: blank last line");
  check(same(loadCharset("a\n\n\n"), ["a", ""]), "charset: blank entry");
  const v = Array.from({ length: 300 }, (_, i) => 1 / (i + 1));
  check(ppocr.npSum(v) === 6.282663880299504, `np_sum pairwise: ${ppocr.npSum(v)}`);
  const block = (text: string, x: number, y: number) => ({
    text,
    quad: [
      [x, y],
      [x + 50, y],
      [x + 50, y + 20],
      [x, y + 20],
    ] as IntQuad,
    confidence: 0.9,
  });
  const sorted = ppocr.readingOrderSort([block("c", 10, 100), block("b", 200, 12), block("a", 10, 10)]);
  check(same(sorted.map((b) => b.text), ["a", "b", "c"]), "reading order");
  summary.push("ocr units (charset lines, numpy pairwise sum, reading order): checked");
}

// ------------------------------------------------------------- engine sections

async function engine(tier: string) {
  const dir = path.join(MODELS, "ocr", `ppocrv6_${tier}`);
  if (!existsSync(path.join(dir, "rec.onnx"))) {
    console.log(`  ${dir} missing, skipping`);
    return null;
  }
  return ppocr.Engine.load(dir);
}

async function edgeSection(tier: string) {
  const g = await load("ocr", `edge_${tier}`);
  if (!g) return;
  const eng = await engine(tier);
  if (!eng) return;
  const fails: string[] = [];
  let checked = 0;
  for (const c of g.cases) {
    const file = c.input.image as string;
    const name = path.basename(file);
    const lossy = name.endsWith(".jpg") || name === "jpeg.tif";
    let img: Image3 | null = null;
    let err: Error | null = null;
    try {
      img = await readImage(file);
    } catch (e) {
      err = e as Error;
    }
    if (c.output.error !== undefined) {
      if (img) fails.push(`${c.id}: decoded ${img.w}x${img.h}, cv2 refused it (${c.output.error})`);
      else checked++;
      continue;
    }
    if (!img) {
      fails.push(`${c.id}: ${err?.message}, cv2 decodes it`);
      continue;
    }
    const want = c.output.decoded;
    if (img.h !== want.shape[0] || img.w !== want.shape[1]) {
      fails.push(`${c.id}: size ${img.w}x${img.h} vs ${JSON.stringify(want.shape)}`);
      continue;
    }
    const px = bgr(img);
    if (lossy) {
      const n = img.w * img.h;
      (want.mean_bgr as number[]).forEach((m, ch) => {
        let s = 0;
        for (let i = ch; i < px.length; i += 3) s += px[i];
        if (Math.abs(s / n - m) > 1) fails.push(`${c.id}: channel ${ch} mean ${(s / n).toFixed(2)} vs ${m}`);
      });
    } else if (sha(px) !== want.sha256) {
      fails.push(`${c.id}: pixels differ from cv2`);
    }
    const pred = await eng.predictImage(img, { ...ppocr.defaultOptions(), minConfidence: 0.6 });
    if (pred.text !== c.output.predict.text) fails.push(`${c.id}: text ${JSON.stringify(pred.text)} vs ${JSON.stringify(c.output.predict.text)}`);
    checked++;
  }
  await eng.release();
  for (const f of fails) console.log(`  ${f}`);
  summary.push(`ocr edge cases ${tier}: ${checked}/${g.cases.length} match (${fails.length} mismatches)`);
  check(fails.length === 0, `ocr edge ${tier}: ${fails.length} mismatches`);
}

const decodedPng = (id: string) => path.join(GOLDENS, "_decoded", "ocr", `${id.replaceAll("/", "__")}.png`);

async function pipelineSection(tier: string) {
  const g = await load("ocr", `pipeline_${tier}`);
  if (!g) return;
  const eng = await engine(tier);
  if (!eng) return;
  const maxSide = eng.config.detMaxSide;
  const opts = { ...ppocr.defaultOptions(), minConfidence: 0.6 };
  const t = {
    images: 0,
    decodeExact: 0,
    probMaps: 0,
    probMaxDiff: 0,
    boxesExactImages: 0,
    boxesPy: 0,
    boxesOurs: 0,
    boxesMatched: 0,
    minIou: 1,
    cropsExact: 0,
    crops: 0,
    recTextSame: 0,
    recConfMaxDiff: 0,
    linesPy: 0,
    linesSame: 0,
    answersExact: 0,
    jpegInputs: 0,
    jpegDecodeExact: 0,
    jpegFiles: 0,
    jpegLinesPy: 0,
    jpegLinesSame: 0,
    jpegAnswersSameText: 0,
  };
  const notes: string[] = [];
  const started = performance.now();
  for (const c of g.cases) {
    const file = c.input.image as string;
    const out = c.output;
    if (out.error !== undefined) {
      let decoded = true;
      try {
        await readImage(file);
      } catch {
        decoded = false;
      }
      check(!decoded, `${c.id}: Python could not decode it`);
      continue;
    }
    t.images++;
    const wantSha = out.decoded.sha256 as string;
    const fromFile = await readImage(file);
    const exact = sha(bgr(fromFile)) === wantSha;
    let img = fromFile;
    const isJpeg = /\.jpe?g$/i.test(file);
    if (isJpeg) t.jpegInputs++;
    if (exact) {
      t.decodeExact++;
      if (isJpeg) t.jpegDecodeExact++;
    }
    else {
      img = await readImage(decodedPng(c.id));
      check(sha(bgr(img)) === wantSha, `${c.id}: decoded png`);
    }

    // detection on cv2's pixels
    if (out.prob) {
      const [ours] = await eng.probMap(img, maxSide);
      t.probMaps++;
      t.probMaxDiff = Math.max(t.probMaxDiff, maxAbsDiff(ours, f32(out.prob)));
    }
    const [boxes, detSize] = await eng.detect(img, maxSide);
    check(same(detSize, out.det_size), `${c.id}: detection input size ${JSON.stringify(detSize)} vs ${JSON.stringify(out.det_size)}`);
    const pyBoxes = out.boxes as IntQuad[];
    if (same(boxes, pyBoxes)) t.boxesExactImages++;
    else notes.push(`${c.id}: boxes ${JSON.stringify(boxes)} vs python ${JSON.stringify(pyBoxes)}`);
    t.boxesPy += pyBoxes.length;
    t.boxesOurs += boxes.length;
    for (const pb of pyBoxes) {
      const best = boxes.reduce((m, b) => Math.max(m, iou(bbox(b), bbox(pb))), 0);
      if (best > 0) t.boxesMatched++;
      t.minIou = Math.min(t.minIou, best);
    }

    // crops and recognition on Python's boxes: isolates the recognizer
    const crops = pyBoxes.map((q) => warp.rotateCrop(img, q));
    crops.forEach((crop, i) => {
      t.crops++;
      if (sha(bgr(crop)) === out.crops[i].sha256) t.cropsExact++;
    });
    const rec = await eng.recognize(crops);
    rec.forEach(([text, conf], i) => {
      const [wt, wc] = out.recognized[i] as [string, number];
      t.recConfMaxDiff = Math.max(t.recConfMaxDiff, Math.abs(conf - wc));
      if (text === wt) t.recTextSame++;
      else notes.push(`${c.id}: recognized ${JSON.stringify(text)} vs ${JSON.stringify(wt)}`);
    });

    // the whole answer
    const pred = await eng.finish(img, boxes, opts);
    const want = out.predict;
    const pyLines = lines(want.text);
    const ourLines = lines(pred.text);
    t.linesPy += pyLines.length;
    t.linesSame += pyLines.filter((l) => ourLines.includes(l)).length;
    const ours = ppocr.predictionJson(pred) as Record<string, any>;
    const blockKeys = (v: Record<string, any>) => (v.blocks as { text: string; box: number[][] }[]).map((b) => [b.text, b.box]);
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    if (
      same(blockKeys(ours), blockKeys(want)) &&
      ours.text === want.text &&
      ours.image_width === want.image_width &&
      ours.image_height === want.image_height &&
      close(ours.mean_confidence, want.mean_confidence) &&
      close(ours.text_area_fraction, want.text_area_fraction)
    )
      t.answersExact++;
    else notes.push(`${c.id}: answer differs:\n    ours ${JSON.stringify(ours)}\n    py   ${JSON.stringify(want)}`);
    const det = ppocr.predictionJson(await eng.finish(img, boxes, { ...opts, detOnly: true })) as Record<string, any>;
    check(det.box_count === out.det_only.box_count, `${c.id}: det_only box_count`);
    check(close(det.text_area_fraction, out.det_only.text_area_fraction), `${c.id}: det_only text_area_fraction`);

    // JPEG files through the server's decoder
    if (!exact) {
      t.jpegFiles++;
      const p = await eng.predictImage(fromFile, opts);
      const ol = lines(p.text);
      t.jpegLinesPy += pyLines.length;
      t.jpegLinesSame += pyLines.filter((l) => ol.includes(l)).length;
      if (p.text === want.text) t.jpegAnswersSameText++;
    }
  }
  const secs = (performance.now() - started) / 1000;
  await eng.release();
  console.log(`  ocr pipeline ${tier}: ${JSON.stringify(t)}`);
  for (const n of notes) console.log(`  ${n}`);
  const lineRate = t.linesSame / Math.max(t.linesPy, 1);
  // JPEGs decoded differently from cv2 (none when sharp's libjpeg-turbo matches it).
  const jpegRate = t.jpegLinesPy ? t.jpegLinesSame / t.jpegLinesPy : 1;
  summary.push(
    `ocr pipeline ${tier} (cv2's pixels, ${t.images} images, ${secs.toFixed(0)} s): lines identical ${t.linesSame}/${t.linesPy} (${(lineRate * 100).toFixed(2)}%), ` +
      `boxes identical on ${t.boxesExactImages}/${t.images} images (${t.boxesOurs} vs ${t.boxesPy}), python boxes matched ${t.boxesMatched}/${t.boxesPy} (min IoU ${t.minIou.toFixed(3)}), ` +
      `crops identical ${t.cropsExact}/${t.crops}, recognized lines identical ${t.recTextSame}/${t.crops} (conf max diff ${t.recConfMaxDiff.toExponential(2)}), ` +
      `answers identical ${t.answersExact}/${t.images}; decode identical to cv2 ${t.decodeExact}/${t.images} (JPEG files ${t.jpegDecodeExact}/${t.jpegInputs})`,
  );
  summary.push(
    `ocr pipeline ${tier} (JPEG files decoded unlike cv2, re-run from the file): lines identical ${t.jpegLinesSame}/${t.jpegLinesPy} (${(jpegRate * 100).toFixed(2)}%), same text ${t.jpegAnswersSameText}/${t.jpegFiles}`,
  );
  check(lineRate >= 0.98, `ocr pipeline ${tier}: line parity ${lineRate}`);
  check(t.minIou >= 0.9, `ocr pipeline ${tier}: box IoU ${t.minIou}`);
  check(jpegRate >= 0.9, `ocr pipeline ${tier}: JPEG line parity ${jpegRate}`);
}

// ------------------------------------------------------------- the service (staged slot path)

/**
 * `inprocess.predict` (what ocr.generate calls): the sidecar's error contract
 * (missing file 400 before any model load, unknown / missing bundle
 * unavailable, undecodable file 400) and the edge cases' answers.
 */
async function inprocessSection() {
  const g = await load("ocr", "edge_tiny");
  if (!g) return;
  const svc = await import("../src/ml/ocr/inprocess");
  const { MlFailed } = await import("../src/ml/errors");
  const { MlUnavailable } = await import("../src/ml/runtime");
  const err = async (f: () => Promise<unknown>) => {
    try {
      await f();
      return null;
    } catch (e) {
      return e as Error;
    }
  };
  const missing = await err(() => svc.predict(path.join(GOLDENS, "nope.png"), "ppocrv6_tiny"));
  check(missing instanceof MlFailed && missing.status === 400 && missing.message === "Image not found", `inprocess: missing file -> ${missing}`);
  const anyImage = g.cases.find((c) => c.output.error === undefined)!.input.image as string;
  const unknown = await err(() => svc.predict(anyImage, "ppocrv9_huge"));
  check(unknown instanceof MlUnavailable, `inprocess: unknown model -> ${unknown}`);
  const none = await err(() => svc.predict(anyImage, "none"));
  check(none instanceof MlUnavailable, `inprocess: no model selected -> ${none}`);
  let ok = 0;
  let exactAnswers = 0;
  for (const c of g.cases) {
    const file = c.input.image as string;
    if (c.output.error !== undefined) {
      const e = await err(() => svc.predict(file, "ppocrv6_tiny"));
      const good = e instanceof MlFailed && e.status === 400;
      check(good, `inprocess ${c.id}: ${e} (cv2 refused it)`);
      ok += good ? 1 : 0;
      continue;
    }
    const want = c.output.predict;
    const p = await svc.ocr(file, "ppocrv6_tiny", 0.6);
    // Pixels unlike cv2's (CMYK JPEG): the text must agree, like the edge section.
    const exact = c.output.decoded.sha256 ? sha(bgr(await readImage(file))) === c.output.decoded.sha256 : false;
    const good =
      p.text === want.text &&
      (!exact ||
        (same(p.blocks.map((b) => [b.text, b.box]), (want.blocks as { text: string; box: number[][] }[]).map((b) => [b.text, b.box])) &&
          p.image_width === want.image_width &&
          p.image_height === want.image_height &&
          Math.abs(p.mean_confidence - want.mean_confidence) < 1e-4 &&
      Math.abs(p.text_area_fraction - want.text_area_fraction) < 1e-4));
    exactAnswers += exact && good ? 1 : 0;
    check(good, `inprocess ${c.id}: ${JSON.stringify(p)} vs ${JSON.stringify(want)}`);
    ok += good ? 1 : 0;
  }
  const det = await svc.predict(anyImage, "ppocrv6_tiny", { minConfidence: 0.6, maxSide: null, detOnly: true });
  check(det.blocks.length === 0 && det.boxCount > 0, "inprocess: det_only");
  summary.push(`ocr service (inprocess.predict, staged slot): error contract checked, edge_tiny ${ok}/${g.cases.length} match (refusals, text; whole answers identical on ${exactAnswers} with cv2's pixels)`);
}

const sections: Record<string, () => Promise<void> | void> = {
  cv2: cv2Section,
  resize: resizeSection,
  geometry: geometrySection,
  units: unitSection,
  edge_tiny: () => edgeSection("tiny"),
  edge_medium: () => edgeSection("medium"),
  inprocess: inprocessSection,
  pipeline_tiny: () => pipelineSection("tiny"),
  pipeline_small: () => pipelineSection("small"),
};
const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(sections)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(`[${name}]`);
  const t0 = performance.now();
  await run();
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
console.log("\n" + summary.join("\n"));
if (failures.length) {
  console.log(`\n${failures.length} FAILURES:`);
  for (const f of failures.slice(0, 50)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nall OCR goldens pass");
