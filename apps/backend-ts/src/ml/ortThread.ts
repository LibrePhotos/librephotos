// Sessions that run on ORT worker threads (ortWorker.ts), with the slice of
// the InferenceSession API the ML services use: run(feeds, fetches?),
// input/output names and metadata, release(). LP_ML_THREADS sets how many
// worker threads host sessions (default 2; 0 = run on the calling thread).
// A session lives on one worker; sessions are spread round-robin.
//
// Pre-allocated fetch tensors (the caption decoder's cache) are honoured by
// copying the worker's results into them, so callers keep reading the same
// buffers. Tensors are structured-cloned both ways (no transfer: callers
// reuse their input buffers).
import type * as Ort from "onnxruntime-node";
import { workerFile } from "../lib/workers";
import type { Reply, Request, WireTensor } from "./ortWorker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let pool: Worker[] | null = null;
let rr = 0;
let seq = 0;
const pending = new Map<number, Pending>();

export function mlThreads(): number {
  const raw = process.env.LP_ML_THREADS;
  if (raw === undefined || raw === "") return 2;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 2;
}

function workers(): Worker[] {
  if (pool) return pool;
  const file = workerFile(import.meta.url, "ortWorker.ts", "ort-worker.js");
  if (!file) throw new Error("ort worker file not found (bun run build builds dist/ort-worker.js)");
  pool = [];
  for (let i = 0; i < mlThreads(); i++) {
    const w = new Worker(file);
    w.onmessage = (e: MessageEvent<Reply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.value);
      else p.reject(new Error(e.data.error));
    };
    (w as Worker & { unref?: () => void }).unref?.();
    pool.push(w);
  }
  return pool;
}

function call<T>(w: Worker, msg: Omit<Request, "id"> & { op: Request["op"] }): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id });
  });
}

const wire = (t: Ort.Tensor): WireTensor => ({ type: t.type, data: t.data, dims: t.dims });

export class ThreadSession {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly worker: Worker,
    private readonly sid: number,
    readonly inputNames: readonly string[],
    readonly outputNames: readonly string[],
    readonly inputMetadata: unknown,
    readonly outputMetadata: unknown,
  ) {}

  static async create(ort: typeof Ort, path: string, options: Ort.InferenceSession.SessionOptions): Promise<ThreadSession> {
    const ws = workers();
    const w = ws[rr++ % ws.length];
    const v = await call<{ sid: number; inputNames: string[]; outputNames: string[]; inputMetadata: unknown; outputMetadata: unknown }>(w, {
      op: "create",
      path,
      options,
    } as never);
    return new ThreadSession(ort, w, v.sid, v.inputNames, v.outputNames, v.inputMetadata, v.outputMetadata);
  }

  async run(feeds: Record<string, Ort.Tensor>, fetches?: readonly string[] | Record<string, Ort.Tensor | null>): Promise<Record<string, Ort.Tensor>> {
    const f: Record<string, WireTensor> = {};
    for (const [k, t] of Object.entries(feeds)) f[k] = wire(t);
    let wf: string[] | Record<string, WireTensor> | undefined;
    const given: Record<string, Ort.Tensor> = {};
    if (Array.isArray(fetches)) wf = [...fetches];
    else if (fetches) {
      wf = {};
      for (const [k, t] of Object.entries(fetches)) {
        if (t) {
          wf[k] = wire(t);
          given[k] = t;
        }
      }
    }
    const out = await call<Record<string, WireTensor>>(this.worker, { op: "run", sid: this.sid, feeds: f, fetches: wf } as never);
    const res: Record<string, Ort.Tensor> = {};
    for (const [k, t] of Object.entries(out)) {
      const mine = given[k];
      if (mine && (mine.data as ArrayLike<unknown>).length === (t.data as ArrayLike<unknown>).length) {
        (mine.data as unknown as { set(a: unknown): void }).set(t.data);
        res[k] = mine;
      } else {
        res[k] = new this.ort.Tensor(t.type, t.data as never, t.dims);
      }
    }
    return res;
  }

  async release(): Promise<void> {
    await call(this.worker, { op: "release", sid: this.sid } as never);
  }
}
