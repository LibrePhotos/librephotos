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
 * ## The iCloud item, and paying for the bytes once
 *
 * An item can arrive with **no hash**: the hash pass parked it as
 * `hash_state = 'icloud'` because its bytes are not on the device (iOS
 * "Optimise iPhone Storage"). For those the worker runs
 * {@link WorkerOptions.materialize} first — the one call allowed to pull an
 * original down — and that call hands back the local uri *and* the md5 of what
 * it fetched. So a single download serves the hash, the `/api/exists` dedupe
 * check and the upload itself, instead of downloading once to hash and again to
 * upload. The hash is persisted on the way past, so an interrupted run does not
 * throw the download away.
 *
 * That download only ever happens here, which means it is already behind the
 * backup toggle and the Wi-Fi/charging gate — hashing itself never triggers one.
 *
 * Pure: transport + gate + materialize + notify are injected; Node-tested with
 * fakes.
 */
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import { sql } from "drizzle-orm";
import { storeHash } from "@/sync/device/hasher";
import type { AssetMaterializer, LocalMediaType } from "@/sync/device/types";
import {
  markDone,
  markFailed,
  markSkipped,
  nextEligible,
  setQueueState,
  BACKOFF_BASE_MS,
  QUEUE_ITEM_COLUMNS,
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
  /**
   * Fetches an iCloud-only original and checksums it in one go. Absent, an
   * unhashed item fails with a message the Backup screen can show rather than
   * being silently dropped.
   */
  materialize?: AssetMaterializer["materialize"];
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
    sql`SELECT ${QUEUE_ITEM_COLUMNS}
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
  const { asset_id: assetId, uri, name } = item;
  if (!uri) {
    markFailed(db, assetId, "asset missing uri", now(), base);
    res.failed += 1;
    res.lastError = "asset missing uri";
    return;
  }
  try {
    // 0. The iCloud case: no hash because the bytes are not here yet. Fetch them
    //    once — this single download feeds the hash, the dedupe check and the
    //    upload below, which all read `hash`/`readableUri`/`fetchedMd5` from here.
    let hash = item.hash;
    let readableUri = uri;
    let fetchedMd5: string | undefined;
    if (!hash) {
      if (!opts.materialize) {
        markFailed(db, assetId, "asset has no hash and no way to fetch it", now(), base);
        res.failed += 1;
        res.lastError = "asset has no hash and no way to fetch it";
        return;
      }
      setQueueState(db, assetId, "checking");
      const fetched = await opts.materialize({
        id: assetId,
        uri,
        type: (item.type as LocalMediaType | null) ?? "image",
      });
      if (!fetched) {
        markFailed(db, assetId, "could not download the original from iCloud", now(), base);
        res.failed += 1;
        res.lastError = "could not download the original from iCloud";
        return;
      }
      readableUri = fetched.uri;
      fetchedMd5 = fetched.md5;
      hash = fetched.md5 + String(opts.userId);
      // Persist before the network round trips: a run killed mid-upload must not
      // have to download the same original all over again.
      storeHash(db, assetId, fetched.md5, opts.userId, now());
    }

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
      { assetId, uri: readableUri, filename, type: item.type, hash, userId: opts.userId, md5: fetchedMd5 },
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
      md5: uploadedMd5 ?? fetchedMd5 ?? rawMd5(hash, opts.userId),
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
