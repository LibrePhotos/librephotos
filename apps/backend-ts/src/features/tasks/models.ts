// `models.download` (ml_models.download_models) and the checks Django chains
// ahead of its ML work (do_all_models_exist / captioning_model_exists /
// start_model_download). Port of lp_tasks::models + lp_ml::models with
// Django's selection rules (the sidecars run ViT-B/32 CLIP, so it is always
// required; Rust's SEMANTIC_SEARCH_MODEL does not apply).
//
// Django's chain runs the download before the job that needs it; this queue
// runs jobs side by side, so ML jobs call waitForDownload() first.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, createWriteStream } from "node:fs";
import { rm, rename } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { JobType, enqueue, registerJob } from "../../lib/jobs";
import { siteSettings, type SiteSettings } from "../../lib/settings";
import { begin, complete, fail, setProgress } from "./run";

export const KIND = "models.download";

type MlType = "captioning" | "face_recognition" | "clip" | "tagging" | "ocr";
type Unpack = "none" | "targz" | "zip";
interface Extra {
  url: string;
  target: string;
  sha256: string;
}
interface ModelSpec {
  name: string;
  url: string;
  type: MlType;
  unpack: Unpack;
  target: string;
  sha256: string;
  extra: Extra[];
}

const HF = "https://huggingface.co";
const IF = "https://github.com/deepinsight/insightface/releases/download/v0.7";
const LP = `${HF}/derneuere/librephotos_models/resolve/main`;
const LFM = `${HF}/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main`;

/** ML_MODELS, in Django's order. */
export const CATALOG: ModelSpec[] = [
  {
    name: "clip_vit_b32",
    url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx`,
    type: "clip",
    unpack: "none",
    target: "clip_vit_b32/vision_model.onnx",
    sha256: "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40",
    extra: [
      { url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx`, target: "clip_vit_b32/text_model.onnx", sha256: "3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc" },
      { url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json`, target: "clip_vit_b32/tokenizer.json", sha256: "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd" },
    ],
  },
  {
    name: "mobileclip_s2",
    url: `${HF}/Xenova/mobileclip_s2/resolve/main/onnx/vision_model.onnx`,
    type: "tagging",
    unpack: "none",
    target: "mobileclip_s2/vision_model.onnx",
    sha256: "d28b92d7a3a6ba99bd000cce5c91678c0e279dc934c887a3785908a811872a6c",
    extra: [
      { url: `${HF}/Xenova/mobileclip_s2/resolve/main/onnx/text_model.onnx`, target: "mobileclip_s2/text_model.onnx", sha256: "ff82e945c6c652c51df687e10f102a8e43c87d37c9108ff692468be3732f3710" },
      { url: `${HF}/Xenova/mobileclip_s2/resolve/main/tokenizer.json`, target: "mobileclip_s2/tokenizer.json", sha256: "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85" },
    ],
  },
  { name: "buffalo_sc", url: `${IF}/buffalo_sc.zip`, type: "face_recognition", unpack: "zip", target: "face_recognition/models/buffalo_sc", sha256: "57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72", extra: [] },
  { name: "buffalo_s", url: `${IF}/buffalo_s.zip`, type: "face_recognition", unpack: "zip", target: "face_recognition/models/buffalo_s", sha256: "d85a87f503f691807cd8bb97128bdf7a0660326cd9cd02657127fa978bab8b5e", extra: [] },
  {
    name: "lfm2_vl_450m",
    url: `${LFM}/onnx/vision_encoder_q4.onnx`,
    type: "captioning",
    unpack: "none",
    target: "lfm2_vl_450m/vision_encoder_q4.onnx",
    sha256: "3457fe118939ecd52183660abafbbd32c810f41a0e8d1119a1f07ca2d4d9dcfc",
    extra: [
      { url: `${LFM}/onnx/vision_encoder_q4.onnx_data`, target: "lfm2_vl_450m/vision_encoder_q4.onnx_data", sha256: "03171ff302af006d2e5f55f9c09531d7938565626334809c94e6de54afc840b5" },
      { url: `${LFM}/onnx/embed_tokens_q4.onnx`, target: "lfm2_vl_450m/embed_tokens_q4.onnx", sha256: "f0d663cbf75fc6a0c7b9669177335139b0c5a63575c6413037d48501eea0c4a5" },
      { url: `${LFM}/onnx/embed_tokens_q4.onnx_data`, target: "lfm2_vl_450m/embed_tokens_q4.onnx_data", sha256: "255994cbb7269ea24b43d3d57a7e64dcb54da69c77ea612f9c32af3dbb95158e" },
      { url: `${LFM}/onnx/decoder_model_merged_q4.onnx`, target: "lfm2_vl_450m/decoder_model_merged_q4.onnx", sha256: "00b4c0ed1008194b6ed813e5d17724db122ef71e963197424022aaf93966515a" },
      { url: `${LFM}/onnx/decoder_model_merged_q4.onnx_data`, target: "lfm2_vl_450m/decoder_model_merged_q4.onnx_data", sha256: "0440e6e97953a70705ef1901cb1267bc80cb69ae7d4ca25010891c5770e989d5" },
      { url: `${LFM}/tokenizer.json`, target: "lfm2_vl_450m/tokenizer.json", sha256: "d3f7877aa8c9ce603604f2cf78c280c24d8b6087c24669610f3391bcd3f703cf" },
    ],
  },
  { name: "buffalo_m", url: `${IF}/buffalo_m.zip`, type: "face_recognition", unpack: "zip", target: "face_recognition/models/buffalo_m", sha256: "d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9", extra: [] },
  {
    name: "siglip2",
    url: `${LP}/siglip2/vision_model.onnx`,
    type: "tagging",
    unpack: "none",
    target: "siglip2/vision_model.onnx",
    sha256: "49ae4958b1098ca995e929d646f7be05a69c65e6344beae07d58c6598ffc5210",
    extra: [
      { url: `${LP}/siglip2/text_model.onnx`, target: "siglip2/text_model.onnx", sha256: "d28c21c7f12c38b0ec43aacb7ce2228fba6bd6b20641802ef2b29809ece46af8" },
      { url: `${LP}/siglip2/tokenizer.model`, target: "siglip2/tokenizer.model", sha256: "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2" },
    ],
  },
  { name: "buffalo_l", url: `${IF}/buffalo_l.zip`, type: "face_recognition", unpack: "zip", target: "face_recognition/models/buffalo_l", sha256: "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f", extra: [] },
  { name: "antelopev2", url: `${IF}/antelopev2.zip`, type: "face_recognition", unpack: "zip", target: "face_recognition/models/antelopev2", sha256: "8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5", extra: [] },
  { name: "ppocrv6_tiny", url: `${LP}/ppocrv6_tiny.tar.gz?download=true`, type: "ocr", unpack: "targz", target: "ocr/ppocrv6_tiny", sha256: "7e534d86a0cb6335c769993f6fd9a29f752b6ed98e93f60808649870baa5440b", extra: [] },
  { name: "ppocrv6_small", url: `${LP}/ppocrv6_small.tar.gz?download=true`, type: "ocr", unpack: "targz", target: "ocr/ppocrv6_small", sha256: "241769eb7750b4a43141a509bee8ac6893517c8b41ec3b5e5c45bdd4fde47c21", extra: [] },
  { name: "ppocrv6_medium", url: `${LP}/ppocrv6_medium.tar.gz?download=true`, type: "ocr", unpack: "targz", target: "ocr/ppocrv6_medium", sha256: "21232b79847cd56d5cae801d3364f95e508b40bb0ce159f31687e63c63959a0b", extra: [] },
];

const dataModels = () => path.join(config.mediaRoot, "data_models");
const notSelected = (v: string) => !v.trim() || v.trim().toLowerCase() === "none";

/** ml_models._is_model_selected. */
function isSelected(m: ModelSpec, s: SiteSettings): boolean {
  switch (m.type) {
    case "tagging":
      return m.name === s.TAGGING_MODEL;
    case "face_recognition":
      return m.name === s.FACE_RECOGNITION_MODEL;
    case "ocr":
      return !notSelected(s.OCR_MODEL) && m.name === s.OCR_MODEL;
    default:
      return true;
  }
}

/** _model_target_exists. */
function targetExists(m: ModelSpec): boolean {
  const root = dataModels();
  const target = path.join(root, m.target);
  if (!existsSync(target)) return false;
  if (m.type === "face_recognition") {
    try {
      if (!readdirSync(target).some((f) => f.toLowerCase().endsWith(".onnx"))) return false;
    } catch {
      return false;
    }
  }
  if (m.type === "ocr" && !["det.onnx", "rec.onnx", "charset.txt", "config.json"].every((f) => existsSync(path.join(target, f)))) return false;
  return m.extra.every((f) => existsSync(path.join(root, f.target)));
}

/** do_all_models_exist. */
export async function allModelsPresent(): Promise<boolean> {
  const s = await siteSettings();
  return CATALOG.filter((m) => isSelected(m, s)).every(targetExists);
}

/** captioning_model_exists. */
export const captioningPresent = () => CATALOG.filter((m) => m.type === "captioning").every(targetExists);

/** Whether a Download Models job is queued or running. */
export async function downloadRunning(): Promise<boolean> {
  const [r] = await client`SELECT EXISTS (SELECT 1 FROM api_longrunningjob WHERE job_type = ${JobType.DownloadModels} AND NOT finished) AS x`;
  return r.x;
}

/** LP_ML_AUTO_DOWNLOAD=0/off/false: never queue downloads (tests, offline installs). */
const autoDownload = () => !["0", "off", "false", "no"].includes((process.env.LP_ML_AUTO_DOWNLOAD ?? "").trim().toLowerCase());

/** start_model_download: queue a Download Models job unless one is underway. True when a download is running now. */
export async function startDownload(userId: number): Promise<boolean> {
  if (!autoDownload()) return false;
  try {
    if (await downloadRunning()) return true;
    await enqueue(KIND, { user_id: userId }, { lrj: { jobType: JobType.DownloadModels, userId } });
    return true;
  } catch (e) {
    console.error(`failed to queue the model download: ${(e as Error).message}`);
    return false;
  }
}

/** The chain step: download the selected models first when any is missing. Never fails the caller. */
export async function queueIfMissing(userId: number): Promise<void> {
  if (!(await allModelsPresent())) await startDownload(userId);
}

/** Wait (up to 30 min, polled every 2 s) while a Download Models job is running. */
export async function waitForDownload(): Promise<void> {
  const started = Date.now();
  let logged = false;
  while (Date.now() - started < 30 * 60_000) {
    let running = false;
    try {
      running = await downloadRunning();
    } catch {
      return;
    }
    if (!running) return;
    if (!logged) {
      console.info("waiting for the model download to finish");
      logged = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn("model download still running after 30 min; continuing");
}

async function downloadFile(url: string, target: string, sha256: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.part`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3 * 3600_000) });
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  const hash = createHash("sha256");
  const out = createWriteStream(tmp);
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    await rm(tmp, { force: true });
    throw e;
  }
  const digest = hash.digest("hex");
  if (digest !== sha256) {
    await rm(tmp, { force: true });
    throw new Error(`checksum mismatch for ${url}: ${digest}`);
  }
  await rename(tmp, target);
}

/** _flatten_wrapper_dir: a zip that holds one folder is unpacked into the target itself. */
function flattenWrapperDir(target: string) {
  try {
    if (!statSync(target).isDirectory()) return;
    const entries = readdirSync(target, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) return;
    const wrapper = path.join(target, `.${entries[0].name}.unwrap`);
    renameSync(path.join(target, entries[0].name), wrapper);
    for (const child of readdirSync(wrapper)) renameSync(path.join(wrapper, child), path.join(target, child));
    rmdirSync(wrapper);
  } catch {
    // nothing to flatten
  }
}

function unpack(archive: string, m: ModelSpec) {
  const root = dataModels();
  const dest = m.unpack === "zip" ? path.join(root, m.target) : root;
  mkdirSync(dest, { recursive: true });
  // bsdtar (Windows, macOS) and GNU tar read .tar.gz; bsdtar also reads zip.
  const args = m.unpack === "zip" && process.platform !== "win32" ? ["-o", "-q", archive, "-d", dest] : ["-xf", archive, "-C", dest];
  const r = spawnSync(m.unpack === "zip" && process.platform !== "win32" ? "unzip" : "tar", args, { windowsHide: true });
  if (r.status !== 0) throw new Error(`extracting ${archive}: ${r.stderr?.toString() || r.error?.message}`);
  if (m.unpack === "zip") flattenWrapperDir(dest);
}

async function downloadModel(m: ModelSpec, s: SiteSettings): Promise<"skipped" | "present" | "downloaded"> {
  if (!isSelected(m, s)) return "skipped";
  const root = dataModels();
  if (m.unpack === "zip") flattenWrapperDir(path.join(root, m.target));
  if (targetExists(m)) return "present";
  const base = path.join(root, m.target);
  const target = m.unpack === "targz" ? `${base}.tar.gz` : m.unpack === "zip" ? `${base}.zip` : base;
  await downloadFile(m.url, target, m.sha256);
  if (m.unpack !== "none") {
    try {
      unpack(target, m);
    } finally {
      await rm(target, { force: true });
    }
  }
  for (const f of m.extra) {
    const t = path.join(root, f.target);
    if (!existsSync(t)) await downloadFile(f.url, t, f.sha256);
  }
  return "downloaded";
}

let downloading: Promise<unknown> = Promise.resolve();

/** download_models: every catalog model in order, progress per model; a failure is recorded and the rest still downloaded. */
async function download(userId: number, lrjId: string | null): Promise<void> {
  const jobId = await begin(lrjId, JobType.DownloadModels, userId);
  const run = async () => {
    await setProgress(jobId, 0, CATALOG.length);
    mkdirSync(dataModels(), { recursive: true });
    const s = await siteSettings();
    const failures: string[] = [];
    for (let i = 0; i < CATALOG.length; i++) {
      const m = CATALOG[i];
      try {
        if ((await downloadModel(m, s)) === "downloaded") console.info(`model ${m.name} installed`);
      } catch (e) {
        console.error(`failed to download model ${m.name}: ${(e as Error).message}`);
        failures.push(`${m.name}: ${(e as Error).message}`);
      }
      await setProgress(jobId, i + 1, CATALOG.length);
    }
    if (failures.length) await fail(jobId, `Failed to download ${failures.join(", ")}`);
    else await complete(jobId);
  };
  // One download at a time per process.
  const p = downloading.then(run, run);
  downloading = p.catch(() => undefined);
  await p;
}

export function registerModelJobs() {
  registerJob(KIND, async (ctx) => {
    const userId = Number(ctx.payload?.user_id);
    if (!Number.isInteger(userId)) throw new Error(`${KIND} payload: user_id missing`);
    await download(userId, ctx.lrjId);
  });
}
