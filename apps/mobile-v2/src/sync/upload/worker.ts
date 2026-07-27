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
import { sql } from "drizzle-orm";
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
  /** Message of the most recent per-item failure, for the caller to surface. */
  lastError?: string;
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

/**
 * Upload exactly ONE asset — the unit an `upload_asset` job runs.
 *
 * The queue-drain loop above still exists for the background task's small
 * budgeted top-up, but the foreground path goes through here: one photo per job
 * means one photo's worth of work is the most an interrupted run can lose, and
 * it lets uploads round-robin with hashing and scanning instead of monopolising
 * the worker until the queue is empty.
 *
 * A blocked gate is reported, not thrown: "waiting for Wi-Fi" is a state to
 * display, not a failure to retry against an attempt budget.
 */
export async function runUploadItem(
  db: AppDatabase,
  assetId: string,
  opts: WorkerOptions
): Promise<{
  uploaded: boolean;
  skipped: boolean;
  failed: boolean;
  gated?: string;
  /** Why it failed — the caller turns this into a *failed job*, not a note. */
  error?: string;
}> {
  const now = opts.now ?? Date.now;
  const base = opts.backoffBase ?? BACKOFF_BASE_MS;

  if (opts.gate) {
    const decision = await opts.gate.check();
    if (!decision.allowed) return { uploaded: false, skipped: false, failed: false, gated: decision.reason };
  }

  const item = db.get(
    sql`SELECT uq.asset_id AS asset_id, uq.state AS state, uq.attempts AS attempts, uq.progress AS progress,
               la.uri AS uri, la.name AS name, la.type AS type, la.hash AS hash,
               la.created_at AS created_at, la.modified_at AS modified_at
        FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE uq.asset_id = ${assetId}`
  ) as QueueItem | undefined;
  // The row can legitimately have vanished (the asset was deleted from the
  // device and swept) or already be done. Neither is an error.
  if (!item) return { uploaded: false, skipped: true, failed: false };
  if (item.state === "done" || item.state === "skipped_exists") {
    return { uploaded: false, skipped: true, failed: false };
  }

  const res: WorkerResult = { uploaded: 0, skipped: 0, failed: 0 };
  await processItem(db, item, opts, now, base, res);
  return {
    uploaded: res.uploaded > 0,
    skipped: res.skipped > 0,
    failed: res.failed > 0,
    error: res.lastError,
  };
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
    res.lastError = "asset missing hash or uri";
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
    const { uploadId, md5: uploadedMd5 } = await opts.transport.uploadFile(
      { assetId, uri, filename, type: item.type, hash, userId: opts.userId },
      (p) => {
        if (p.total > 0) setQueueState(db, assetId, "uploading", p.sent / p.total);
        opts.onProgress?.(assetId, p.sent, p.total);
      }
    );

    // 3. Finalize with device-timestamp fallback (issue #614). The checksum is
    // the one the transport measured on the bytes it just sent; the stored hash
    // is only a fallback, because a hash recorded during the hash pass can be
    // stale by the time the bytes go out and the server rejects the mismatch
    // with a permanent 400 (see UploadResult.md5).
    await opts.transport.complete({
      uploadId,
      filename,
      md5: uploadedMd5 ?? rawMd5(hash, opts.userId),
      userId: opts.userId,
      deviceCreatedAt: item.created_at ?? null,
      deviceModifiedAt: item.modified_at ?? null,
    });

    markDone(db, assetId);
    res.uploaded += 1;
    opts.onUploaded?.(assetId);
  } catch (err) {
    if (opts.signal?.aborted) throw new UploadAbortedError();
    const message = err instanceof Error ? err.message : String(err);
    markFailed(db, assetId, message, now(), base);
    res.failed += 1;
    res.lastError = message;
  }
}
