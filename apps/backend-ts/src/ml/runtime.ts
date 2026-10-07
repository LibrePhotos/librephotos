// In-process ML runtime (port of the parts of lp_ml::{runtime, slot} the
// services share): ONNX Runtime sessions through onnxruntime-node, loaded
// lazily per model, serialized per model, unloaded when idle.
//
//   const s = await modelSlot("clip", "mobileclip_s2/vision", () => session(path));
//   const out = await s.run((sess) => sess.run({ pixel_values: tensor }));
//
// Models live under MEDIA_ROOT/data_models, shared with Django and Rust
// (LP_DATA_MODELS overrides). Env, same names as librephotos-rs:
//   ONNX_INTRA_OP_THREADS        threads per session (0/unset = ORT default)
//   LP_ML_IDLE_UNLOAD_SECS       unload a model after this long unused (120)
//   LP_ML_<SERVICE>_CONCURRENCY  parallel runs per model (1)
//   LP_ORT_CPU_ARENA             0 = sessions without the CPU memory arena
import path from "node:path";
import type * as Ort from "onnxruntime-node";
import { config } from "../lib/config";

export type { Ort };
export type InferenceSession = Ort.InferenceSession;

let ortModule: Promise<typeof Ort> | null = null;

/**
 * onnxruntime-node, imported on first use: the server bundle evaluates every
 * route module at boot, so a static import would load the native library
 * into every idle server.
 */
export const loadOrt = (): Promise<typeof Ort> => (ortModule ??= import("onnxruntime-node"));

export type Service = "clip" | "similarity" | "tags" | "ocr" | "face" | "caption" | "face_cluster" | "raw_thumbnail";

export const dataModels = () => process.env.LP_DATA_MODELS ?? path.join(config.mediaRoot, "data_models");

const intraThreads = () => {
  const n = Number(process.env.ONNX_INTRA_OP_THREADS ?? 0);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** An ORT session with the process-wide options (CPU EP, graph optimizations on). */
export async function session(modelPath: string, extra: Ort.InferenceSession.SessionOptions = {}): Promise<Ort.InferenceSession> {
  const ort = await loadOrt();
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    intraOpNumThreads: intraThreads(),
    interOpNumThreads: 1,
    // LP_ORT_CPU_ARENA=0: no per-session arena (ORT keeps an arena's peak for
    // the session's life; onnxruntime-node has no shared, shrinkable arena
    // like librephotos-rs). Models may override (the face packs turn it off).
    enableCpuMemArena: process.env.LP_ORT_CPU_ARENA !== "0",
    ...extra,
  });
}

/** A whole-model failure the caller reports like the sidecar's "unavailable". */
export class MlUnavailable extends Error {}

const idleMs = () => Number(process.env.LP_ML_IDLE_UNLOAD_SECS ?? 120) * 1000;

/** One lazily loaded model with a run queue and idle unload. */
export class ModelSlot<T> {
  private value: Promise<T> | null = null;
  private active = 0;
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly label: string,
    private load: () => Promise<T>,
    private release: (v: T) => Promise<void> | void,
    private concurrency: number,
  ) {}

  async run<R>(f: (v: T) => Promise<R>): Promise<R> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this.value ??= this.load().catch((e) => {
        this.value = null;
        throw e;
      });
      return await f(await this.value);
    } finally {
      this.active--;
      this.waiters.shift()?.();
      if (this.active === 0 && this.waiters.length === 0) this.scheduleUnload();
    }
  }

  private scheduleUnload() {
    const ms = idleMs();
    if (ms <= 0) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.active || !this.value) return;
      const v = this.value;
      this.value = null;
      try {
        await this.release(await v);
      } catch {
        /* already gone */
      }
      Bun.gc(false);
    }, ms);
    this.timer.unref?.();
  }

  get loaded() {
    return this.value !== null;
  }
}

const slots = new Map<string, ModelSlot<unknown>>();

/** The slot for (service, key), created on first use. */
export function modelSlot<T>(
  service: Service,
  key: string,
  load: () => Promise<T>,
  release: (v: T) => Promise<void> | void = (v) => (v as { release?: () => Promise<void> })?.release?.(),
): ModelSlot<T> {
  const id = `${service}/${key}`;
  let s = slots.get(id) as ModelSlot<T> | undefined;
  if (!s) {
    const conc = Number(process.env[`LP_ML_${service.toUpperCase()}_CONCURRENCY`] ?? 1);
    s = new ModelSlot<T>(id, load, release, Number.isInteger(conc) && conc > 0 ? conc : 1);
    slots.set(id, s as ModelSlot<unknown>);
  }
  return s;
}

/** Which models are resident (for /api/services-style diagnostics and tests). */
export const loadedModels = () => [...slots.values()].filter((s) => s.loaded).map((s) => s.label);

export type Mode = "inprocess" | "sidecar";

/**
 * LP_ML_<SERVICE> = inprocess | sidecar | auto (default). auto = in-process
 * when the service is implemented here and its sidecar URL is not
 * redirected (LP_SIDECAR_<NAME>_URL, e.g. the test mock), like librephotos-rs.
 */
export function modeFor(service: Service, implemented: boolean): Mode {
  const v = (process.env[`LP_ML_${service.toUpperCase()}`] ?? "auto").toLowerCase();
  if (v === "inprocess") return "inprocess";
  if (v === "sidecar") return "sidecar";
  const sidecarEnv = `LP_SIDECAR_${service.toUpperCase()}_URL`;
  return implemented && !process.env[sidecarEnv] ? "inprocess" : "sidecar";
}
