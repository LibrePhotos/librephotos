// ServiceViewSet (/api/services/, staff only): the ML sidecar list, a health
// probe per sidecar (polled every 15 s) and start/stop. Port of
// lp_api::jobs_zip_services::services and lp_sidecars::supervisor, minus
// lp-ml's in-process mode: every service here is its Python sidecar, as in
// Django. Only a sidecar this process started can be stopped (Django killed
// every process whose command line looked like one).
import { existsSync } from "node:fs";
import path from "node:path";
import type { Subprocess } from "bun";
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import { siteSettings } from "~/lib/settings";

interface Spec {
  name: string;
  port: number;
  flag: string | null;
  /** LP_SIDECAR_<ENV>_URL redirects it (config.sidecar). */
  env: string;
}

const SERVICES: Spec[] = [
  { name: "image_similarity", port: 8002, flag: null, env: "similarity" },
  { name: "thumbnail", port: 8003, flag: null, env: "thumbnail" },
  { name: "face_recognition", port: 8005, flag: "FEATURE_FACE_DETECTION", env: "face" },
  { name: "clip_embeddings", port: 8006, flag: null, env: "clip" },
  { name: "image_captioning", port: 8007, flag: "FEATURE_IMAGE_CAPTIONING", env: "caption" },
  { name: "tags", port: 8011, flag: "FEATURE_SCENE_CLASSIFICATION", env: "tags" },
  { name: "ocr", port: 8012, flag: null, env: "ocr" },
  { name: "face_cluster", port: 8013, flag: "FEATURE_FACE_CLUSTER", env: "face_cluster" },
];

const FLAGS: Record<string, boolean> = {
  FEATURE_FACE_DETECTION: config.features.faceDetection,
  FEATURE_IMAGE_CAPTIONING: config.features.imageCaptioning,
  FEATURE_SCENE_CLASSIFICATION: config.features.sceneClassification,
  FEATURE_FACE_CLUSTER: config.features.faceCluster,
};

/** apps/backend: holds service/<name>/main.py and image_similarity/ (LP_BACKEND_DIR overrides). */
const backendDir = () => process.env.LP_BACKEND_DIR ?? path.resolve(path.dirname(Bun.main), "..", "backend");

function script(name: string): string {
  const dir = backendDir();
  if (name === "image_similarity") return path.join(dir, "image_similarity", "main.py");
  const s = path.join(dir, "service", name, "main.py");
  // Only the Rust port has face_cluster: apps/backend-rs/sidecars/face_cluster.
  if (name === "face_cluster" && !existsSync(s)) return path.join(dir, "..", "backend-rs", "sidecars", name, "main.py");
  return s;
}

/** Sidecars whose script exists in this checkout. */
const services = () => SERVICES.filter((s) => s.name !== "face_cluster" || existsSync(script(s.name)));
const spec = (name: string) => services().find((s) => s.name === name);
const flagOn = (flag: string | null) => flag === null || (FLAGS[flag] ?? true);

/** ml_models._is_model_not_selected, inverted. */
const modelSelected = (v: string) => v.trim() !== "" && v.trim().toLowerCase() !== "none";

/** is_service_enabled: OCR is switched by the OCR_MODEL site setting, not a flag. */
async function isEnabled(s: Spec): Promise<boolean> {
  if (s.name === "ocr" && !modelSelected((await siteSettings()).OCR_MODEL)) return false;
  return flagOn(s.flag);
}

const disabledReason = (s: Spec) => (s.flag !== null && !flagOn(s.flag) ? `${s.flag} is disabled` : "no model is selected for it in the site settings");

const notFound = (name: string) => json({ error: `Service ${name} not found` }, 404);

const children = new Map<string, Subprocess>();
const isRunning = (name: string) => {
  const c = children.get(name);
  if (c && c.exitCode === null && c.signalCode === null) return true;
  children.delete(name);
  return false;
};

export function listServices() {
  return { services: Object.fromEntries(services().map((s) => [s.name, s.port])) };
}

/** A probe that fails while our process is still alive means "busy", not dead (one request at a time). */
async function isHealthy(s: Spec): Promise<boolean> {
  try {
    const res = await fetch(`${config.sidecar(s.env, s.port)}/health`, { signal: AbortSignal.timeout(5000) });
    await res.body?.cancel();
    return res.status === 200;
  } catch {
    return isRunning(s.name);
  }
}

/** A switched-off sidecar is not probed (nothing listens there). */
export async function serviceStatus(name: string) {
  const s = spec(name);
  if (!s) return notFound(name);
  const enabled = await isEnabled(s);
  const healthy = enabled && (await isHealthy(s));
  return { service_name: name, healthy, enabled, feature_flag: s.flag, mode: "sidecar" };
}

export async function startService(name: string) {
  const s = spec(name);
  if (!s) return notFound(name);
  if (!(await isEnabled(s))) return json({ error: `Service ${name} is not started: ${disabledReason(s)}`, feature_flag: s.flag }, 409);
  if (isRunning(name)) return { message: `Service ${name} started successfully` };
  try {
    const dir = backendDir();
    const child = Bun.spawn([config.python, script(name)], {
      cwd: dir,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH ? `${dir}${path.delimiter}${process.env.PYTHONPATH}` : dir,
        BASE_DATA: config.baseData,
        BASE_LOGS: config.baseLogs,
        LOG_LEVEL: (process.env.LOG_LEVEL ?? "info").toUpperCase(),
      },
    });
    children.set(name, child);
    console.log(`service ${name} started (pid ${child.pid})`);
    return { message: `Service ${name} started successfully` };
  } catch (e) {
    console.error(`service ${name} start failed`, e);
    return json({ error: `Failed to start service ${name}` }, 500);
  }
}

export async function stopService(name: string) {
  if (!spec(name)) return notFound(name);
  const child = children.get(name);
  children.delete(name);
  if (!child || child.exitCode !== null || child.signalCode !== null) return json({ error: `Failed to stop service ${name}` }, 500);
  child.kill();
  await Promise.race([child.exited, Bun.sleep(5000)]);
  console.log(`service ${name} stopped`);
  return { message: `Service ${name} stopped successfully` };
}
