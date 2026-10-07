// Golden parity of the in-process face and face_cluster ports against the
// Python sidecar outputs (apps/backend-rs/tests/ml/golden_face*.py), with the
// tolerances of lp-ml's tests/face.rs and tests/face_cluster.rs.
//
//   LP_DATA_MODELS=.../rust-pg/ml/protected_media/data_models \
//   bun run scripts/ml_goldens_face.ts [face] [packs] [cluster] [mlp] [train] [pca]
//
// No argument runs everything except the four extra packs. LP_ML_GOLDENS
// overrides the goldens root (default <librephotos>/rust-pg/ml-goldens).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FaceBox } from "../src/features/tasks/sidecars";
import { SidecarError } from "../src/features/tasks/sidecars";
import { loadRgb } from "../src/ml/face/image";
import { detectFacesInProcess, faceEncodingsInProcess, packDir } from "../src/ml/face/index";
import { FacePack } from "../src/ml/face/pack";
import * as fc from "../src/ml/face_cluster/index";
import { Mlp, Mt19937 } from "../src/ml/face_cluster/mlp";

const ROOT = process.env.LP_ML_GOLDENS ?? path.resolve(import.meta.dir, "../../../../rust-pg/ml-goldens");
process.env.LP_DATA_MODELS ??= path.resolve(import.meta.dir, "../../../../rust-pg/ml/protected_media/data_models");
process.env.LP_ML_FACE = "inprocess";
process.env.LP_ML_FACE_CLUSTER = "inprocess";

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

function load(service: string, name: string): Case[] | null {
  const p = path.join(ROOT, service, `${name}.json`);
  if (!existsSync(p)) {
    console.log(`golden ${p} missing, skipping`);
    return null;
  }
  return JSON.parse(readFileSync(p, "utf8")).cases;
}

function bytes(a: Arr): Buffer {
  return Buffer.from(a.b64, "base64");
}

function f32s(a: Arr): Float32Array {
  const b = bytes(a);
  if (a.dtype === "float32") return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  if (a.dtype === "float64") return Float32Array.from(new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
  throw new Error(`not a float array: ${a.dtype}`);
}

function rows(a: Arr | null | undefined): number[][] {
  if (!a) return [];
  if (a.dtype !== "float64") throw new Error(`rows: ${a.dtype}`);
  const b = bytes(a);
  const flat = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const d = a.shape.length > 1 ? a.shape[1] : 1;
  if (d === 0) return Array.from({ length: a.shape[0] }, () => []);
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += d) out.push(Array.from(flat.subarray(i, i + d)));
  return out;
}

const hex = (v: number[]) => {
  const b = Buffer.alloc(v.length * 8);
  v.forEach((x, i) => b.writeDoubleLE(x, i * 8));
  return b.toString("hex");
};

const ints = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error("vector lengths");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return na === nb ? 1 : 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function iouXyxy(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const iw = Math.max(Math.min(a[2], b[2]) - Math.max(a[0], b[0]), 0);
  const ih = Math.max(Math.min(a[3], b[3]) - Math.max(a[1], b[1]), 0);
  const inter = iw * ih;
  const area = (r: ArrayLike<number>) => Math.max(r[2] - r[0], 0) * Math.max(r[3] - r[1], 0);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}
const iouTrbl = (a: FaceBox, b: FaceBox) => iouXyxy([a[3], a[0], a[1], a[2]], [b[3], b[0], b[1], b[2]]);

let failures = 0;
function check(ok: boolean, what: string) {
  if (!ok) {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

const loc = (v: number[]): FaceBox => [v[0], v[1], v[2], v[3]];

// --------------------------------------------------------------- faces

async function checkPack(model: string) {
  const cases = load("face", model);
  const dir = packDir(model);
  if (!cases || !existsSync(dir)) return;
  const pack = await FacePack.load(dir);
  const st = {
    faces: 0,
    exactLocations: 0,
    minIou: 1,
    cropsIdentical: 0,
    maxCropDiff: 0,
    minCosine: 1,
    minCosineLossless: 1,
    minCosineSameCrop: 1,
    sameCropIdentical: 0,
  };
  const t0 = performance.now();
  for (const c of cases) {
    const image = await loadRgb(c.input.source);
    const faces = await pack.analyze(image, "all");
    const lossless = !c.id.toLowerCase().endsWith(".jpg");
    const want = c.output.faces as Record<string, Arr>[];
    const wantLocs = (c.output.face_locations as number[][]).map(loc);
    if (faces.length !== want.length) {
      check(false, `${model} ${c.id}: face count ${faces.length} vs ${want.length} (${JSON.stringify(faces.map((f) => f.location))} vs ${JSON.stringify(wantLocs)})`);
      continue;
    }
    for (let i = 0; i < want.length; i++) {
      st.faces++;
      const w = want[i];
      const wb = f32s(w.bbox);
      let j = 0;
      let best = -1;
      faces.forEach((f, k) => {
        const v = iouXyxy(f.detection.bbox, wb);
        if (v >= best) {
          best = v;
          j = k;
        }
      });
      check(j === i, `${model} ${c.id}: face order`);
      const f = faces[j];
      check(best >= 0.95, `${model} ${c.id} face ${i}: box IoU ${best}`);
      st.minIou = Math.min(st.minIou, best);
      if (f.location.every((v, k) => v === wantLocs[i][k])) st.exactLocations++;
      const crop = pack.align(image, f.detection);
      const wantCrop = bytes(w.crop);
      let d = 0;
      let n = 0;
      for (let k = 0; k < crop.length; k++) {
        const x = Math.abs(crop[k] - wantCrop[k]);
        if (x) {
          n++;
          d = Math.max(d, x);
        }
      }
      if (!n) st.cropsIdentical++;
      st.maxCropDiff = Math.max(st.maxCropDiff, d);
      const wantEmb = f32s(w.embedding);
      const cos = cosine(f.embedding!, wantEmb);
      check(cos >= 0.99, `${model} ${c.id} face ${i}: cosine ${cos}`);
      st.minCosine = Math.min(st.minCosine, cos);
      if (lossless) st.minCosineLossless = Math.min(st.minCosineLossless, cos);
      const same = n === 0 ? f.embedding! : (await pack.recognizer.embedMany([new Uint8Array(wantCrop)]))[0];
      st.minCosineSameCrop = Math.min(st.minCosineSameCrop, cosine(same, wantEmb));
      if (same.every((v, k) => v === wantEmb[k])) st.sameCropIdentical++;
    }
  }
  await pack.release();
  const ms = performance.now() - t0;
  console.log(`${model}: ${JSON.stringify(st)} (${cases.length} images, ${(ms / cases.length).toFixed(1)} ms/image)`);
  check(st.minCosineSameCrop > 0.99999, `${model}: same-crop cosine ${st.minCosineSameCrop}`);
  check(st.minCosineLossless >= 0.999, `${model}: lossless cosine ${st.minCosineLossless}`);
}

async function checkEncodings() {
  const cases = load("face", "encodings");
  if (!cases) return;
  let compared = 0;
  let minCos = 1;
  for (const c of cases) {
    const locations = (c.input.face_locations as number[][]).map(loc);
    const got = await faceEncodingsInProcess(c.input.source, locations, c.input.model_name);
    const want = c.output.encodings as (Arr | null)[];
    if (got.length !== want.length) {
      check(false, `${c.id}: ${got.length} slots vs ${want.length}`);
      continue;
    }
    got.forEach((g, k) => {
      const w = want[k];
      if (g === null || w === null) {
        check(g === null && w === null, `${c.id} #${k}: matched ${g !== null} vs python ${w !== null}`);
        return;
      }
      const cos = cosine(g, f32s(w));
      minCos = Math.min(minCos, cos);
      check(cos >= 0.99, `${c.id} #${k}: cosine ${cos}`);
      compared++;
    });
  }
  console.log(`face_encodings: ${cases.length} cases, ${compared} embeddings, min cosine ${minCos.toFixed(6)}`);
}

async function checkApi() {
  const cases = load("face", "buffalo_sc");
  if (!cases) return;
  const c = cases.find((x) => x.id.endsWith("t1.jpg"))!;
  const got = await detectFacesInProcess(c.input.source, "no-such-pack");
  const want = (c.output.face_locations as number[][]).map(loc);
  check(got.length === want.length, `api: ${got.length} faces vs ${want.length}`);
  got.forEach((f, i) => {
    check(iouTrbl(f.location, want[i]) >= 0.95, `api face ${i}`);
    check(f.encoding?.length === 512, `api face ${i} encoding length`);
  });
  try {
    await detectFacesInProcess("C:/definitely/missing.jpg", "buffalo_sc");
    check(false, "missing file: no error");
  } catch (e) {
    check(e instanceof SidecarError && e.kind === "status" && e.status === 500, `missing file: ${e}`);
  }
  const saved = process.env.LP_DATA_MODELS;
  process.env.LP_DATA_MODELS = path.join(ROOT, "no-models-here");
  try {
    await detectFacesInProcess(c.input.source, "buffalo_sc");
    check(false, "no pack: no error");
  } catch (e) {
    check(e instanceof SidecarError && e.kind === "unreachable", `no pack: ${e}`);
  }
  process.env.LP_DATA_MODELS = saved;
  console.log("face api: unknown model -> buffalo_sc, missing file -> 500, missing pack -> unreachable");
}

async function checkE2e() {
  const cases = load("face", "e2e");
  const dir = packDir("buffalo_sc");
  if (!cases || !existsSync(dir)) return;
  const pack = await FacePack.load(dir);
  let minCos = 1;
  let faces = 0;
  for (const c of cases) {
    const got = await pack.analyze(await loadRgb(c.input.source), "all");
    const want = (c.output.face_locations as number[][]).map(loc);
    check(JSON.stringify(got.map((f) => f.location)) === JSON.stringify(want), `e2e ${c.id}: ${JSON.stringify(got.map((f) => f.location))} vs ${JSON.stringify(want)}`);
    got.forEach((f, i) => {
      if (c.output.encodings[i]) minCos = Math.min(minCos, cosine(f.embedding!, f32s(c.output.encodings[i])));
    });
    faces += got.length;
  }
  await pack.release();
  console.log(`e2e thumbnails: ${cases.length} images, ${faces} faces, min cosine ${minCos.toFixed(6)}`);
  check(minCos >= 0.999, `e2e min cosine ${minCos}`);
}

async function checkEdge() {
  const cases = load("face", "edge");
  if (!cases) return;
  let minCos = 1;
  for (const c of cases) {
    let got: Awaited<ReturnType<typeof detectFacesInProcess>> | null = null;
    let err: unknown = null;
    try {
      got = await detectFacesInProcess(c.input.source, "buffalo_sc");
    } catch (e) {
      err = e;
    }
    if (c.output.status !== 200) {
      check(err instanceof SidecarError && err.status === 500, `${c.id}: python ${c.output.status}, ts ${err ?? JSON.stringify(got?.map((f) => f.location))}`);
      console.log(`  ${c.id}: refused (${err instanceof Error ? err.message.slice(0, 80) : "no error"})`);
      continue;
    }
    if (!got) {
      check(false, `${c.id}: ${err}`);
      continue;
    }
    const want = (c.output.face_locations as number[][]).map(loc);
    if (got.length !== want.length) {
      check(false, `${c.id}: ${JSON.stringify(got.map((f) => f.location))} vs ${JSON.stringify(want)}`);
      continue;
    }
    let caseIou = 1;
    let caseCos = 1;
    got.forEach((f, i) => {
      const v = iouTrbl(f.location, want[i]);
      check(v >= 0.95, `${c.id} face ${i}: IoU ${v}`);
      const cos = cosine(f.encoding!, f32s(c.output.encodings[i]));
      check(cos >= 0.99, `${c.id} face ${i}: cosine ${cos}`);
      caseIou = Math.min(caseIou, v);
      caseCos = Math.min(caseCos, cos);
    });
    minCos = Math.min(minCos, caseCos);
    console.log(`  ${c.id}: ${got.length} faces, min IoU ${caseIou.toFixed(4)}, min cosine ${caseCos.toFixed(6)}`);
  }
  console.log(`odd inputs: ${cases.length} cases, min cosine ${minCos.toFixed(6)}`);
}

// --------------------------------------------------------- face_cluster

/** Adjusted Rand index, noise (-1) counted as one label. */
function ari(a: number[], b: number[]): number {
  const n = a.length;
  const comb = (x: number) => (x * (x - 1)) / 2;
  const table = new Map<string, number>();
  const ra = new Map<number, number>();
  const rb = new Map<number, number>();
  a.forEach((x, i) => {
    const k = `${x},${b[i]}`;
    table.set(k, (table.get(k) ?? 0) + 1);
    ra.set(x, (ra.get(x) ?? 0) + 1);
    rb.set(b[i], (rb.get(b[i]) ?? 0) + 1);
  });
  const sum = (m: Map<unknown, number>) => [...m.values()].reduce((s, v) => s + comb(v), 0);
  const index = sum(table);
  const sa = sum(ra);
  const sb = sum(rb);
  const expected = (sa * sb) / comb(n);
  const max = (sa + sb) / 2;
  if (max === expected) return 1;
  return (index - expected) / (max - expected);
}

const both = (name: string) => [...(load("face_cluster", name) ?? []), ...(load("face_cluster", `${name}_edge`) ?? [])];

function errorDetail(e: unknown): string {
  if (e instanceof SidecarError && e.kind === "status") return e.detail ?? e.message;
  throw e;
}

async function checkCluster() {
  let worst = 1;
  for (const c of both("cluster")) {
    const enc = rows(c.input.encodings);
    const faces = enc.map((e, i) => ({ id: i + 1, encoding: hex(e) }));
    const t = performance.now();
    let labels: number[] | null = null;
    let err = "";
    try {
      const r = await fc.clusterInProcess({
        faces,
        min_cluster_size: c.input.min_cluster_size,
        min_samples: c.input.min_samples,
        cluster_selection_epsilon: c.input.cluster_selection_epsilon,
      });
      check(r.ids.join() === faces.map((f) => f.id).join(), `${c.id}: ids`);
      labels = r.labels;
    } catch (e) {
      err = errorDetail(e);
    }
    const secs = (performance.now() - t) / 1000;
    if (c.output.status !== 200) {
      check(labels === null && err === c.output.error, `${c.id}: error ${JSON.stringify(err)} vs ${JSON.stringify(c.output.error)}`);
      console.log(`cluster ${c.id.padEnd(28)} error matches`);
      continue;
    }
    if (!labels) {
      check(false, `${c.id}: ${err}`);
      continue;
    }
    const want = ints(c.output.labels);
    const truth = ints(c.input.truth);
    const same = labels.filter((l, i) => l === want[i]).length;
    const score = ari(labels, want);
    worst = Math.min(worst, score);
    console.log(
      `cluster ${c.id.padEnd(28)} n=${String(want.length).padEnd(5)} ARI(ts, python)=${score.toFixed(4)} identical=${same}/${want.length} ARI vs truth: ts ${ari(labels, truth).toFixed(3)} python ${ari(want, truth).toFixed(3)} (${secs.toFixed(2)}s)`,
    );
    check(score >= 0.9, `${c.id}: ARI ${score}`);
  }
  console.log(`cluster: worst ARI ${worst.toFixed(4)}`);
}

function checkMlp() {
  const cases = load("face_cluster", "mlp");
  if (!cases) return;
  const rng = cases.find((c) => c.id === "rng")!;
  const want = new Float64Array(bytes(rng.output.uniform).buffer.slice(0));
  const r = new Mt19937(1);
  const ours = Array.from(want, () => r.uniform(-0.1, 0.1));
  check(
    ours.every((v, i) => v === want[i]),
    "rng: uniform draws bit-identical",
  );
  const p = Array.from({ length: 1000 }, (_, i) => i);
  r.shuffle(p);
  check(p.join() === ints(rng.output.shuffle_1000).join(), "rng: shuffle_1000");
  console.log(`mlp rng: ${want.length} uniform draws + shuffle checked`);
  for (const c of cases.filter((x) => x.id !== "rng")) {
    const x = rows(c.input.x);
    const t = performance.now();
    const m = Mlp.fit(x, ints(c.input.y));
    const secs = (performance.now() - t) / 1000;
    check(m.classes.join() === ints(c.output.classes).join(), `${c.id}: classes`);
    const p2 = m.predictProba(rows(c.input.x_test));
    const w = rows(c.output.proba);
    let diff = 0;
    let argSame = 0;
    const argmax = (v: number[]) => v.reduce((b, x, i) => (x > v[b] ? i : b), 0);
    p2.forEach((row, i) => {
      row.forEach((v, k) => (diff = Math.max(diff, Math.abs(v - w[i][k]))));
      if (argmax(row) === argmax(w[i])) argSame++;
    });
    const nIter = c.output.n_iter as number;
    console.log(`mlp ${c.id.padEnd(8)} n_iter ts ${m.nIter} sklearn ${nIter}, max |dp| ${diff.toExponential(2)}, argmax same ${argSame}/${p2.length} (${secs.toFixed(2)}s)`);
    check(Math.abs(m.nIter - nIter) <= 2, `${c.id}: n_iter`);
    check(diff < 1e-4, `${c.id}: |dp| ${diff}`);
    check(argSame === p2.length, `${c.id}: argmax`);
  }
}

async function checkTrain() {
  const labelled = (ids: unknown, enc: Arr | null) => {
    const r = rows(enc);
    return ints(ids).map((p, i) => ({ person_id: p, encoding: hex(r[i]) }));
  };
  for (const c of both("train")) {
    const i = c.input;
    const unknownRows = rows(i.unknown?.encodings);
    const req = {
      known: labelled(i.known?.ids, i.known?.encodings),
      clusters: labelled(i.clusters?.ids, i.clusters?.encodings),
      unknown: ints(i.unknown?.ids).map((id, k) => ({ id, encoding: hex(unknownRows[k]) })),
    };
    const t = performance.now();
    let preds: fc.FacePrediction[] | null = null;
    let err = "";
    try {
      preds = (await fc.trainInProcess(req)).predictions;
    } catch (e) {
      err = errorDetail(e);
    }
    const secs = (performance.now() - t) / 1000;
    if (c.output.status !== 200) {
      check(preds === null && err === c.output.error, `${c.id}: error ${JSON.stringify(err)} vs ${JSON.stringify(c.output.error)}`);
      console.log(`train ${c.id.padEnd(26)} error matches`);
      continue;
    }
    if (!preds) {
      check(false, `${c.id}: ${err}`);
      continue;
    }
    const want = c.output.predictions as fc.FacePrediction[];
    if (preds.length !== want.length) {
      check(false, `${c.id}: ${preds.length} predictions vs ${want.length}`);
      continue;
    }
    let sameCluster = 0;
    let sameClass = 0;
    let dp = 0;
    preds.forEach((a, k) => {
      const b = want[k];
      check(a.id === b.id, `${c.id}: id order`);
      if (a.cluster_person_id === b.cluster_person_id) sameCluster++;
      if (a.classification_person_id === b.classification_person_id) sameClass++;
      dp = Math.max(dp, Math.abs(a.cluster_probability - b.cluster_probability), Math.abs(a.classification_probability - b.classification_probability));
    });
    const truth = new Map(Object.entries(i.truth ?? {}).map(([k, v]) => [Number(k), Number(v)]));
    const hits = preds.filter((p) => truth.has(p.id)).map((p) => p.classification_person_id === truth.get(p.id));
    const acc = hits.length ? hits.filter(Boolean).length / hits.length : null;
    const pyAcc = c.output.accuracy ?? null;
    console.log(
      `train ${c.id.padEnd(26)} n=${String(want.length).padEnd(5)} cluster person same ${sameCluster}/${want.length} classification same ${sameClass}/${want.length} max |dp| ${dp.toExponential(2)} accuracy ts ${acc} sklearn ${pyAcc} (${secs.toFixed(2)}s, python ${Number(c.output.seconds ?? 0).toFixed(2)}s)`,
    );
    if (acc !== null && pyAcc !== null) check(Math.abs(acc - pyAcc) <= 0.02, `${c.id}: accuracy ${acc} vs ${pyAcc}`);
    check(sameCluster >= 0.99 * want.length, `${c.id}: cluster person ${sameCluster}/${want.length}`);
  }
}

async function checkPca() {
  for (const c of both("pca")) {
    const enc = rows(c.input.x).map(hex);
    let ours: number[][] | null = null;
    let err = "";
    try {
      ours = await fc.pcaInProcess(enc);
    } catch (e) {
      err = errorDetail(e);
    }
    if (c.output.error) {
      check(ours === null && err === c.output.error, `${c.id}: error ${JSON.stringify(err)} vs ${JSON.stringify(c.output.error)}`);
      console.log(`pca ${c.id.padEnd(16)} error matches`);
      continue;
    }
    if (!ours) {
      check(false, `${c.id}: ${err}`);
      continue;
    }
    const want = rows(c.output.coordinates);
    const scale = Math.max(1e-12, ...want.flat().map(Math.abs));
    const perComp = [0, 1, 2].map((k) => Math.max(...ours!.map((r, i) => Math.abs(r[k] - want[i][k]))));
    const variance = (m: number[][], k: number) => m.reduce((s, r) => s + r[k] * r[k], 0);
    const ov = [0, 1, 2].map((k) => variance(ours!, k));
    const wv = [0, 1, 2].map((k) => variance(want, k));
    console.log(`pca ${c.id.padEnd(16)} n=${want.length} max |d| per component ${perComp.map((d) => d.toExponential(2)).join(", ")} (scale ${scale.toFixed(3)})`);
    if (want.length >= 10 * 512) check(perComp.every((d) => d <= 1e-6 * scale), `${c.id}: ${perComp}`);
    else
      for (let k = 0; k < 3; k++) {
        const o = ov.slice(0, k + 1).reduce((a, b) => a + b, 0);
        const w = wv.slice(0, k + 1).reduce((a, b) => a + b, 0);
        check(o >= w * (1 - 1e-9), `${c.id}: top ${k + 1} ${o} < ${w}`);
      }
  }
}

const args = new Set(process.argv.slice(2));
const all = args.size === 0;
if (all || args.has("face")) {
  await checkPack("buffalo_sc");
  await checkEncodings();
  await checkApi();
  await checkE2e();
  await checkEdge();
}
if (args.has("packs")) for (const m of ["buffalo_s", "buffalo_m", "buffalo_l", "antelopev2"]) await checkPack(m);
if (all || args.has("mlp")) checkMlp();
if (all || args.has("pca")) await checkPca();
if (all || args.has("train")) await checkTrain();
if (all || args.has("cluster")) await checkCluster();
console.log(failures ? `\n${failures} FAILURES` : "\nall golden checks passed");
process.exit(failures ? 1 : 0);
