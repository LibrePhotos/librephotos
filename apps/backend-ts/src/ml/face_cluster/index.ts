// Face clustering and classification (face_cluster sidecar :8013) in process
// or through the sidecar, per LP_ML_FACE_CLUSTER (see runtime.modeFor). Port
// of lp_ml::face_cluster::{FaceClusterApi, InProcess}. In process, each call
// runs on a worker thread (compute.ts), LP_ML_FACE_CLUSTER_CONCURRENCY
// (default 1, like the single-threaded sidecar) at a time; a fit failure is
// the sidecar's 500 with the Python error text.
import { workerFile } from "../../lib/workers";
import * as sidecars from "../../features/tasks/sidecars";
import { SidecarError } from "../../features/tasks/sidecars";
import { modeFor, modelSlot } from "../runtime";
import { FitError, runOp, type ClusterRequest, type FacePrediction, type Op, type TrainRequest } from "./compute";

export type { ClusterRequest, FacePrediction, TrainRequest };

/** The in-process port passes its goldens: `auto` mode uses it. */
export const IMPLEMENTED = true;

export const faceClusterMode = () => modeFor("face_cluster", IMPLEMENTED);

const failed = (msg: string) => new SidecarError("status", "face_cluster", "in-process", `face_cluster failed: ${msg}`, 500, msg);

// Not a literal `new URL("./worker.ts", import.meta.url)`: Vite would turn that
// into an asset of the route bundle, where the worker's imports do not resolve.
// The bundle uses dist/face-cluster-worker.js (bun run build) instead.
function onWorker(m: Op): Promise<unknown> {
  const file = process.env.LP_ML_FACE_CLUSTER_WORKER === "0" ? null : workerFile(import.meta.url, "worker.ts", "face-cluster-worker.js");
  if (!file) return runOp(m);
  return new Promise((resolve, reject) => {
    const w = new Worker(file);
    w.onmessage = (e: MessageEvent<{ ok: boolean; value?: unknown; fit?: boolean; error?: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.value);
      else reject(e.data.fit ? new FitError(e.data.error) : new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(`face_cluster worker: ${e.message}`));
    };
    w.postMessage(m);
  });
}

async function run<T>(m: Op): Promise<T> {
  // No model: the slot only gives the calls their concurrency limit.
  const slot = modelSlot("face_cluster", "fit", async () => null, () => undefined);
  try {
    return (await slot.run(() => onWorker(m))) as T;
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof FitError) console.warn(`face_cluster fit failed: ${msg}`);
    throw failed(e instanceof FitError ? msg : `face_cluster task: ${msg}`);
  }
}

export async function clusterInProcess(req: ClusterRequest): Promise<{ ids: number[]; labels: number[] }> {
  if (!req.faces.length) return { ids: [], labels: [] };
  return run({ op: "cluster", req });
}

export const trainInProcess = async (req: TrainRequest): Promise<{ predictions: FacePrediction[] }> => ({
  predictions: await run<FacePrediction[]>({ op: "train", req }),
});

export async function pcaInProcess(encodings: string[]): Promise<[number, number, number][]> {
  if (!encodings.length) return [];
  return run({ op: "pca", req: encodings });
}

/** `/cluster`, in process or through the sidecar (one label per face). */
export function clusterFaces(req: ClusterRequest): Promise<{ ids: number[]; labels: number[] }> {
  return faceClusterMode() === "inprocess" ? clusterInProcess(req) : sidecars.clusterFaces(req);
}

/** `/train`, in process or through the sidecar. */
export function trainFaces(req: TrainRequest): Promise<{ predictions: FacePrediction[] }> {
  return faceClusterMode() === "inprocess" ? trainInProcess(req) : sidecars.trainFaces(req);
}

/** `/pca`: 3-D coordinates of the (hex) encodings, in order. */
export function facePca(encodings: string[]): Promise<[number, number, number][]> {
  return faceClusterMode() === "inprocess" ? pcaInProcess(encodings) : sidecars.facePca(encodings);
}
