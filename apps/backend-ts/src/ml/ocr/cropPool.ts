// OCR crops on worker threads (cropWorker.ts). The photo's pixels are copied
// once into a SharedArrayBuffer every worker reads; crops are spread over
// the workers and come back in order. LP_OCR_CROP_WORKERS sets the pool
// size (default min(3, cores - 1); 0 = crop on the calling thread).
import { workerFile } from "../../lib/workers";
import type { CropReply, CropRequest } from "./cropWorker";
import type { IntQuad } from "./poly";
import { rotateCrop } from "./warp";

type Img = { w: number; h: number; data: Uint8Array };
type Pending = { resolve: (v: Img) => void; reject: (e: Error) => void };

let pool: Worker[] | null = null;
let seq = 0;
let keys = 0;
let rr = 0;
const pending = new Map<number, Pending>();

function size(): number {
  const raw = process.env.LP_OCR_CROP_WORKERS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }
  return Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
}

function workers(): Worker[] {
  if (pool) return pool;
  pool = [];
  const file = size() > 0 ? workerFile(import.meta.url, "cropWorker.ts", "ocr-crop-worker.js") : null;
  if (!file) return pool;
  for (let i = 0; i < size(); i++) {
    const w = new Worker(file);
    w.onmessage = (e: MessageEvent<CropReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ w: e.data.w, h: e.data.h, data: e.data.data });
      else p.reject(new Error(e.data.error));
    };
    (w as Worker & { unref?: () => void }).unref?.();
    pool.push(w);
  }
  return pool;
}

const post = (w: Worker, m: CropRequest) => w.postMessage(m);

/** rotateCrop for every quad, in order. */
export async function cropAll(img: Img, quads: IntQuad[]): Promise<Img[]> {
  const ws = workers();
  if (!ws.length || !quads.length) return quads.map((q) => rotateCrop(img, q));
  // Rotate the starting worker: most photos have one or two boxes.
  const start = rr++;
  const used = Array.from({ length: Math.min(ws.length, quads.length) }, (_, i) => ws[(start + i) % ws.length]);
  const shared = new Uint8Array(new SharedArrayBuffer(img.data.byteLength));
  shared.set(img.data);
  const key = ++keys;
  for (const w of used) post(w, { op: "image", key, data: shared, w: img.w, h: img.h });
  try {
    return await Promise.all(
      quads.map((quad, i) => {
        const id = ++seq;
        return new Promise<Img>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          post(used[i % used.length], { op: "crop", id, key, quad });
        });
      }),
    );
  } finally {
    for (const w of used) post(w, { op: "drop", key });
  }
}
