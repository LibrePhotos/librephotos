// ServiceViewSet (`/api/services/`, staff only): the sidecar list, a health
// probe per sidecar (polled every 15 s) and start/stop. Port of
// lp_api::jobs_zip_services::services and lp_sidecars::supervisor. Every ML
// service is a Python sidecar here (TS has no in-process ML), so the status
// is always mode "sidecar". Only a sidecar this process started can be
// stopped (Django killed every process whose command line looked like one).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import { siteSettings } from "~/lib/settings";

interface ServiceSpec {
  name: string;
  port: number;
  /** SERVICE_FEATURE_FLAGS; null = core, always on. */
  featureFlag: string | null;
}

const SERVICES: ServiceSpec[] = [
  { name: "image_similarity", port: 8002, featureFlag: null },
  { name: "thumbnail", port: 8003, featureFlag: null },
  { name: "face_recognition", port: 8005, featureFlag: "FEATURE_FACE_DETECTION" },
  { name: "clip_embeddings", port: 8006, featureFlag: null },
  { name: "image_captioning", port: 8007, featureFlag: "FEATURE_IMAGE_CAPTIONING" },
  { name: "tags", port: 8011, featureFlag: "FEATURE_SCENE_CLASSIFICATION" },
  { name: "ocr", port: 8012, featureFlag: null },
  { name: "face_cluster", port: 8013, featureFlag: "FEATURE_FACE_CLUSTER" },
];

const FLAGS: Record<string, boolean> = {
  FEATURE_FACE_DETECTION: config.features.faceDetection,
  FEATURE_IMAGE_CAPTIONING: config.features.imageCaptioning,
  FEATURE_SCENE_CLASSIFICATION: config.features.sceneClassification,
  FEATURE_FACE_CLUSTER: config.features.faceCluster,
};

/** apps/backend: holds service/<name>/main.py and image_similarity/ (the server runs from apps/backend-ts). */
const BACKEND_DIR = process.env.LP_BACKEND_DIR ?? path.resolve(process.cwd(), "..", "backend");

function script(name: string): string {
  if (name === "image_similarity") return path.join(BACKEND_DIR, "image_similarity", "main.py");
  const s = path.join(BACKEND_DIR, "service", name, "main.py");
  // Only the Rust port has it: apps/backend-rs/sidecars/face_cluster.
  if (name === "face_cluster" && !existsSync(s)) return path.join(BACKEND_DIR, "..", "backend-rs", "sidecars", name, "main.py");
  return s;
}

/** Sidecars whose script exists in this checkout. */
const services = () => SERVICES.filter((s) => s.name !== "face_cluster" || existsSync(script(s.name)));
const spec = (name: string) => services().find((s) => s.name === name);
const flagOn = (flag: string | null) => flag === null || (FLAGS[flag] ?? true);
/** ml_models._is_model_not_selected, inverted. */
const modelSelected = (v: string) => !!v.trim() && v.trim().toLowerCase() !== "none";

/** is_service_enabled: OCR is switched by the OCR_MODEL site setting, not a flag. */
async function isEnabled(name: string): Promise<boolean> {
  const s = spec(name);
  if (!s) return false;
  if (name === "ocr" && !modelSelected((await siteSettings()).OCR_MODEL)) return false;
  return flagOn(s.featureFlag);
}

function disabledReason(name: string): string {
  const flag = spec(name)?.featureFlag ?? null;
  if (flag !== null && !flagOn(flag)) return `${flag} is disabled`;
  return "no model is selected for it in the site settings";
}

const children = new Map<string, ChildProcess>();
const alive = (c: ChildProcess | undefined) => !!c && c.exitCode === null && c.signalCode === null;

/** is_healthy: /health answers 200 within 5 s. */
async function isHealthy(s: ServiceSpec): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/health`, { signal: AbortSignal.timeout(5000) });
    await res.body?.cancel();
    return res.status === 200;
  } catch {
    return false;
  }
}

/** start_service: false when the spawn failed; a sidecar already running is not started twice. */
function startService(name: string): boolean {
  if (alive(children.get(name))) return true;
  const env: Record<string, string | undefined> = {
    ...process.env,
    PYTHONPATH: [BACKEND_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    BASE_DATA: config.baseData,
    BASE_LOGS: config.baseLogs,
    LOG_LEVEL: (process.env.LOG_LEVEL ?? "info").toUpperCase(),
  };
  try {
    const child = spawn(config.python, [script(name)], { cwd: BACKEND_DIR, env, stdio: "ignore", windowsHide: true });
    let failed = false;
    child.once("error", (e) => {
      failed = true;
      console.error(`service ${name} start failed`, e);
    });
    if (failed || child.pid === undefined) return false;
    children.set(name, child);
    console.log(`service ${name} started (pid ${child.pid})`);
    return true;
  } catch (e) {
    console.error(`service ${name} start failed`, e);
    return false;
  }
}

async function stopService(name: string): Promise<boolean> {
  const child = children.get(name);
  children.delete(name);
  if (!alive(child)) return false;
  if (!child!.kill()) return false;
  await Promise.race([new Promise((r) => child!.once("exit", r)), Bun.sleep(5000)]);
  return true;
}

const notFound = (name: string) => json({ error: `Service ${name} not found` }, 404);

export function listServices() {
  return { services: Object.fromEntries(services().map((s) => [s.name, s.port])) };
}

/** A switched-off sidecar is not probed (nothing listens there). */
export async function serviceStatus(name: string) {
  const s = spec(name);
  if (!s) return notFound(name);
  const enabled = await isEnabled(name);
  const healthy = enabled && (await isHealthy(s));
  return { service_name: name, healthy, enabled, feature_flag: s.featureFlag, mode: "sidecar" };
}

export async function startServiceView(name: string) {
  const s = spec(name);
  if (!s) return notFound(name);
  if (!(await isEnabled(name))) {
    return json({ error: `Service ${name} is not started: ${disabledReason(name)}`, feature_flag: s.featureFlag }, 409);
  }
  return startService(name)
    ? { message: `Service ${name} started successfully` }
    : json({ error: `Failed to start service ${name}` }, 500);
}

export async function stopServiceView(name: string) {
  if (!spec(name)) return notFound(name);
  return (await stopService(name))
    ? { message: `Service ${name} stopped successfully` }
    : json({ error: `Failed to stop service ${name}` }, 500);
}
