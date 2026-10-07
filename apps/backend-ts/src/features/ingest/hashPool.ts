// A small pool of worker threads for hashWorker's pixel math (pHash and the
// dominant colour), so the main thread stays free for the DB and ExifTool.
// LP_SCAN_HASH_WORKERS sets the size (default min(4, cores - 2); 0 = inline).
// The worker script is dist/hash-worker.js (bun run build) or, when running
// from source, hashWorker.ts itself.
import { existsSync } from "node:fs";
import path from "node:path";
import { runHashTask, type HashTask } from "./hashWorker";

type Pending = { resolve: (v: string | null) => void; reject: (e: Error) => void };

let workers: Worker[] | null = null;
let next = 0;
let seq = 0;
const pending = new Map<number, Pending>();

function workerFile(): string | null {
  const here = import.meta.dir;
  const candidates = [
    path.join(here, "hashWorker.ts"),
    path.join(here, "hash-worker.js"),
    path.join(here, "..", "hash-worker.js"),
    path.join(here, "..", "..", "hash-worker.js"),
    path.join(process.cwd(), "dist", "hash-worker.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function poolSize(): number {
  const raw = process.env.LP_SCAN_HASH_WORKERS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
}

function pool(): Worker[] {
  if (workers) return workers;
  const file = poolSize() > 0 ? workerFile() : null;
  workers = [];
  if (!file) return workers;
  for (let i = 0; i < poolSize(); i++) {
    const w = new Worker(file);
    w.onmessage = (e: MessageEvent<{ id: number; result: string | null; error: string | null }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    (w as Worker & { unref?: () => void }).unref?.(); // idle workers must not keep the CLI alive
    workers.push(w);
  }
  return workers;
}

/** pHash or dominant colour of decoded pixels, on a worker thread when there is one. */
export function hashPixels(kind: HashTask["kind"], data: Uint8Array, width: number, height: number, channels: number): Promise<string | null> {
  const ws = pool();
  if (!ws.length) return Promise.resolve(runHashTask({ kind, data, width, height, channels }));
  const id = ++seq;
  const w = ws[next++ % ws.length];
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Copy into a transferable buffer of its own (sharp's Buffer may be a pool slice).
    const own = new Uint8Array(data);
    w.postMessage({ id, kind, data: own, width, height, channels } satisfies HashTask, [own.buffer]);
  });
}
