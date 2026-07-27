/**
 * Hash pipeline (doc 03 §4). For every un-hashed local asset, compute the
 * LibrePhotos file hash — `md5(bytes) + str(userId)` (matches `File.hash`
 * server-side, apps/backend/api/models/file.py) — and store it on
 * `local_asset.hash`.
 *
 * Ordering: backup-selected albums first (those are what will actually upload),
 * newest-modified first. Batches of ~50 with a yield between batches so the UI
 * thread stays responsive; cancellable via an AbortSignal. Videos are hashed
 * lazily — only when `includeVideos` is set (the upload top-up passes it for
 * selected videos), since hashing GB-scale files eagerly wastes battery.
 *
 * The md5 itself comes from an injected {@link AssetHasher}; the pure pipeline
 * (selection, batching, composition, invalidation) is Node-tested with a fake.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import { HASH_BATCH_SIZE } from "@/sync/jobs/types";
import type { AssetHasher, LocalMediaType } from "./types";

/**
 * Default assets per batch when the caller does not pass one. The job queue
 * always does (it is the adaptive per-job budget), so this only covers direct
 * callers and tests — but it tracks the queue's constant so the two cannot drift
 * back apart. See {@link HASH_BATCH_SIZE} for why 50 was too many.
 */
export const HASH_BATCH = HASH_BATCH_SIZE;

export class HashAbortedError extends Error {
  constructor() {
    super("hash pass aborted");
    this.name = "HashAbortedError";
  }
}

type Candidate = {
  id: string;
  uri: string;
  type: LocalMediaType;
};

export type HashOptions = {
  userId: number;
  signal?: AbortSignal;
  batchSize?: number;
  /** Include videos (lazy hashing — used by the upload top-up). Default false. */
  includeVideos?: boolean;
  /** Restrict to assets in backup-selected (not excluded) albums. Default false. */
  selectedOnly?: boolean;
  now?: number;
  log?: (entry: SyncLogEntry) => void;
  /** Yield hook between batches (defaults to a macrotask yield). */
  yield?: () => Promise<void>;
  /**
   * Called after every batch is persisted. md5 over every byte of a multi-GB
   * library takes minutes, so the caller uses this to enqueue uploads (and
   * refresh the UI) *as assets are hashed* rather than only at the end — a
   * backgrounded or interrupted run then still leaves usable work queued.
   */
  onBatch?: (progress: HashResult) => void;
  /**
   * Stay alive while this returns true even when nothing is currently
   * hashable. The orchestrator passes "the camera-roll scan is still running",
   * so hashing keeps picking up assets as the scan commits them instead of
   * exiting on the first empty batch and waiting for the next sync.
   */
  keepGoing?: () => boolean;
  /** Poll interval (ms) used while idling under {@link HashOptions.keepGoing}. */
  idleDelayMs?: number;
  /**
   * Stop after this many assets have been attempted. The job queue passes it so
   * one `hash_batch` job is a bounded, sub-second unit of work that can be
   * interrupted cheaply — without it a single call runs the whole library and we
   * are back to an unbreakable step.
   */
  maxAssets?: number;
};

export type HashResult = {
  hashed: number;
  failed: number;
  /** True when the pass stopped on its budget with work still outstanding. */
  more?: boolean;
};

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long to idle between "is there anything to hash yet?" polls. */
const IDLE_DELAY_MS = 150;

/**
 * Select un-hashed candidates. Backup-selected assets sort first (they gate the
 * upload queue); within that, most-recently-modified first. Excluded albums are
 * never returned. Videos only when `includeVideos`.
 */
export function selectUnhashed(
  db: AppDatabase,
  opts: { includeVideos?: boolean; selectedOnly?: boolean; limit: number }
): Candidate[] {
  const videoClause = opts.includeVideos ? sql`` : sql`AND la.type <> 'video'`;
  const selectedExpr = sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                                   WHERE laa.asset_id = la.id AND l.backup_selection = 1)`;
  const excludedExpr = sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                                   WHERE laa.asset_id = la.id AND l.backup_selection = 2)`;
  const selectedFilter = opts.selectedOnly ? sql`AND ${selectedExpr} AND NOT ${excludedExpr}` : sql``;
  // `hashed_at IS NULL` gates un-attempted rows: a successful hash sets both
  // hash + hashed_at; a permanent read failure sets hashed_at only (hash stays
  // NULL, so the asset is never enqueued for upload). A modified_at change
  // clears both (upsertLocalAssets), re-queuing the row.
  return db.all(
    sql`SELECT la.id AS id, la.uri AS uri, la.type AS type
        FROM local_asset la
        WHERE la.hash IS NULL AND la.hashed_at IS NULL AND la.uri IS NOT NULL ${videoClause} ${selectedFilter}
        ORDER BY (CASE WHEN ${selectedExpr} THEN 0 ELSE 1 END) ASC, la.modified_at DESC
        LIMIT ${opts.limit}`
  ) as Candidate[];
}

/** Persist a computed hash (`md5 + userId`) onto the asset row. */
export function storeHash(db: AppDatabase, assetId: string, md5: string, userId: number, now: number): void {
  db.run(
    sql`UPDATE local_asset SET hash = ${md5 + String(userId)}, hashed_at = ${now} WHERE id = ${assetId}`
  );
}

/**
 * Run the hash pass to exhaustion (or until aborted). Processes in batches,
 * yielding between them. Per-asset md5 failures are counted, not fatal.
 */
export async function runHashPass(
  db: AppDatabase,
  hasher: AssetHasher,
  opts: HashOptions
): Promise<HashResult> {
  const batchSize = opts.batchSize ?? HASH_BATCH;
  const maxAssets = opts.maxAssets ?? Infinity;
  const now = opts.now ?? Date.now();
  const yieldFn = opts.yield ?? defaultYield;
  let hashed = 0;
  let failed = 0;
  let more = false;

  for (;;) {
    if (opts.signal?.aborted) throw new HashAbortedError();
    if (hashed + failed >= maxAssets) {
      // Budget spent. Report whether anything is still outstanding so the caller
      // (a `hash_batch` job) knows to enqueue its continuation.
      more =
        selectUnhashed(db, {
          includeVideos: opts.includeVideos,
          selectedOnly: opts.selectedOnly,
          limit: 1,
        }).length > 0;
      break;
    }
    const batch = selectUnhashed(db, {
      includeVideos: opts.includeVideos,
      selectedOnly: opts.selectedOnly,
      limit: Math.min(batchSize, maxAssets - hashed - failed),
    });
    if (batch.length === 0) {
      // Nothing hashable *right now*. If a concurrent camera-roll scan is still
      // committing rows, idle briefly and look again rather than ending the
      // pass — otherwise a reload would leave a half-hashed library untouched
      // until some later sync happened to run after the scan finished.
      if (!opts.keepGoing?.()) break;
      await sleep(opts.idleDelayMs ?? IDLE_DELAY_MS);
      continue;
    }

    for (const asset of batch) {
      if (opts.signal?.aborted) throw new HashAbortedError();
      let md5: string | null = null;
      try {
        md5 = await hasher.md5(asset);
      } catch {
        md5 = null;
      }
      if (md5) {
        storeHash(db, asset.id, md5, opts.userId, now);
        hashed += 1;
      } else {
        failed += 1;
        // Mark attempted (hashed_at set, hash left NULL) so a permanently
        // unreadable asset isn't re-selected forever. Cleared on the next
        // modified_at change (upsertLocalAssets).
        db.run(sql`UPDATE local_asset SET hashed_at = ${now} WHERE id = ${asset.id}`);
      }
    }
    opts.onBatch?.({ hashed, failed });
    await yieldFn();
  }

  opts.log?.({ op: "hash", level: "info", applied: hashed, message: `hashed ${hashed}, failed ${failed}` });
  return { hashed, failed, more };
}
