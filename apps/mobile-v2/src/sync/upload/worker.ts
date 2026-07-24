/**
 * Serial upload worker (doc 03 §5). Drains `upload_queue` one item at a time:
 *
 *   pending → checking → (exists? skipped_exists) | uploading → done
 *                                                        ↘ failed (backoff)
 *
 * For each item: gate check (wifi/charging) → `GET /api/exists/{hash}` → chunked
 * upload → `/api/upload/complete/` WITH device timestamps (EXIF-less date
 * fallback) → mark done → notify (so the orchestrator pulls a photos delta and
 * the merged-timeline badge flips). Exponential backoff + capped attempts; the
 * queue is a table, so it survives restarts.
 *
 * Pure: transport + gate + notify are injected; Node-tested with fakes.
 */
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import {
  markDone,
  markFailed,
  markSkipped,
  nextEligible,
  setQueueState,
  BACKOFF_BASE_MS,
  type QueueItem,
} from "./queue";
import type { UploadGate } from "./gate";
import { rawMd5, type UploadTransport } from "./transport";

export class UploadAbortedError extends Error {
  constructor() {
    super("upload worker aborted");
    this.name = "UploadAbortedError";
  }
}

export type WorkerOptions = {
  userId: number;
  transport: UploadTransport;
  gate?: UploadGate;
  signal?: AbortSignal;
  /** Max items to process in this run (background time budget). Default 50. */
  maxItems?: number;
  now?: () => number;
  backoffBase?: number;
  log?: (entry: SyncLogEntry) => void;
  /** Called after a successful upload/complete (triggers a photos delta pull). */
  onUploaded?: (assetId: string) => void;
  /** Progress callback for the UI (per-item bytes). */
  onProgress?: (assetId: string, sent: number, total: number) => void;
};

export type WorkerResult = {
  uploaded: number;
  skipped: number;
  failed: number;
  /** Set when the run stopped because the gate blocked (not drained). */
  stoppedReason?: "gated" | "aborted" | "drained" | "budget";
  gateReason?: string;
};

export async function runUploadQueue(db: AppDatabase, opts: WorkerOptions): Promise<WorkerResult> {
  const now = opts.now ?? Date.now;
  const maxItems = opts.maxItems ?? 50;
  const base = opts.backoffBase ?? BACKOFF_BASE_MS;
  const res: WorkerResult = { uploaded: 0, skipped: 0, failed: 0 };
  let processed = 0;

  for (;;) {
    if (opts.signal?.aborted) {
      res.stoppedReason = "aborted";
      break;
    }
    if (processed >= maxItems) {
      res.stoppedReason = "budget";
      break;
    }
    if (opts.gate) {
      const decision = await opts.gate.check();
      if (!decision.allowed) {
        res.stoppedReason = "gated";
        res.gateReason = decision.reason;
        break;
      }
    }

    const item = nextEligible(db, now());
    if (!item) {
      res.stoppedReason = "drained";
      break;
    }
    processed += 1;
    await processItem(db, item, opts, now, base, res);
  }

  opts.log?.({
    op: "upload",
    level: "info",
    applied: res.uploaded,
    message: `uploaded ${res.uploaded}, skipped ${res.skipped}, failed ${res.failed}, stop=${res.stoppedReason}`,
  });
  return res;
}

async function processItem(
  db: AppDatabase,
  item: QueueItem,
  opts: WorkerOptions,
  now: () => number,
  base: number,
  res: WorkerResult
): Promise<void> {
  const { asset_id: assetId, hash, uri, name } = item;
  if (!hash || !uri) {
    markFailed(db, assetId, "asset missing hash or uri", now(), base);
    res.failed += 1;
    return;
  }
  try {
    // 1. Dedup check — a server row will arrive via delta; the join absorbs it.
    setQueueState(db, assetId, "checking");
    if (await opts.transport.exists(hash)) {
      markSkipped(db, assetId);
      res.skipped += 1;
      return;
    }

    // 2. Chunked upload of the bytes.
    setQueueState(db, assetId, "uploading", 0);
    const filename = name ?? assetId;
    const { uploadId } = await opts.transport.uploadFile(
      { assetId, uri, filename, type: item.type, hash, userId: opts.userId },
      (p) => {
        if (p.total > 0) setQueueState(db, assetId, "uploading", p.sent / p.total);
        opts.onProgress?.(assetId, p.sent, p.total);
      }
    );

    // 3. Finalize with device-timestamp fallback (issue #614).
    await opts.transport.complete({
      uploadId,
      filename,
      md5: rawMd5(hash, opts.userId),
      userId: opts.userId,
      deviceCreatedAt: item.created_at ?? null,
      deviceModifiedAt: item.modified_at ?? null,
    });

    markDone(db, assetId);
    res.uploaded += 1;
    opts.onUploaded?.(assetId);
  } catch (err) {
    if (opts.signal?.aborted) throw new UploadAbortedError();
    markFailed(db, assetId, err instanceof Error ? err.message : String(err), now(), base);
    res.failed += 1;
  }
}
