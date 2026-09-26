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
 * ## Hashing never downloads
 *
 * The hasher is asked for a *local* md5 only. An asset whose bytes live in
 * iCloud (iOS "Optimise iPhone Storage") answers `{ status: "remote" }`, and
 * this pass records that on the row (`hash_state = 'icloud'`) instead of
 * blocking for seconds while a multi-megabyte original comes down the wire —
 * which is what made "Preparing photos" cost ~1.8 s per photo on a real iPhone.
 * Deferred rows leave the hash pass alone (they are excluded from
 * {@link selectUnhashed}, so `more` cannot spin on them) and are picked up by
 * the upload path, which downloads them *once* and hashes the bytes on their
 * way out.
 *
 * The md5 itself comes from an injected {@link AssetHasher}; the pure pipeline
 * (selection, batching, composition, invalidation) is Node-tested with a fake.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import { HASH_BATCH_SIZE } from "@/sync/jobs/types";
import type { AssetHasher, AssetHashResult, LocalMediaType } from "./types";

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
  /** Assets whose bytes are only in iCloud — deferred to the upload path. */
  deferred: number;
  /** True when the pass stopped on its budget with work still outstanding. */
  more?: boolean;
  /** Wall-clock ms spent in {@link AssetHasher.hash}, for the sync log. */
  elapsedMs?: number;
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
  //
  // `hash_state IS NULL` drops the iCloud-deferred rows. This is load-bearing:
  // they keep `hashed_at` NULL (they have not been *attempted*, they are
  // waiting), so without this clause every batch would re-select them, re-learn
  // they are remote, and report `more` forever.
  return db.all(
    sql`SELECT la.id AS id, la.uri AS uri, la.type AS type
        FROM local_asset la
        WHERE la.hash IS NULL AND la.hashed_at IS NULL AND la.hash_state IS NULL
          AND la.uri IS NOT NULL ${videoClause} ${selectedFilter}
        ORDER BY (CASE WHEN ${selectedExpr} THEN 0 ELSE 1 END) ASC, la.modified_at DESC
        LIMIT ${opts.limit}`
  ) as Candidate[];
}

/**
 * Persist a computed hash (`md5 + userId`) onto the asset row. Clears
 * `hash_state` too: whatever was once deferred has now been read.
 */
export function storeHash(db: AppDatabase, assetId: string, md5: string, userId: number, now: number): void {
  db.run(
    sql`UPDATE local_asset SET hash = ${md5 + String(userId)}, hashed_at = ${now}, hash_state = NULL
        WHERE id = ${assetId}`
  );
}

/** The `hash_state` value meaning "the bytes are in iCloud, not on this device". */
export const HASH_STATE_ICLOUD = "icloud";

/**
 * Park an asset as "bytes not on this device". `hashed_at` stays NULL — nothing
 * has been *attempted* — so the row returns to the hash pass for free the moment
 * {@link clearDeferredHashes} runs (a user retry, or the asset coming back down
 * from iCloud), while `hash_state` keeps it out of the current pass.
 */
export function deferHash(db: AppDatabase, assetId: string): void {
  db.run(sql`UPDATE local_asset SET hash_state = ${HASH_STATE_ICLOUD} WHERE id = ${assetId}`);
}

/**
 * Un-defer every iCloud-parked asset so the next hash pass re-checks local
 * availability. Cheap (a no-network `getAssetInfoAsync` each) and the only way
 * the mirror notices that the user turned "Optimise iPhone Storage" off or that
 * iOS pulled the originals back down. Returns how many rows were revived.
 */
export function clearDeferredHashes(db: AppDatabase): number {
  const n = (
    db.get(sql`SELECT COUNT(*) AS c FROM local_asset WHERE hash_state = ${HASH_STATE_ICLOUD}`) as {
      c: number;
    }
  ).c;
  db.run(sql`UPDATE local_asset SET hash_state = NULL WHERE hash_state = ${HASH_STATE_ICLOUD}`);
  return n;
}

/** How many assets are parked waiting for their bytes to come down from iCloud. */
export function countDeferred(db: AppDatabase): number {
  return (
    db.get(sql`SELECT COUNT(*) AS c FROM local_asset WHERE hash_state = ${HASH_STATE_ICLOUD}`) as {
      c: number;
    }
  ).c;
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
  let deferred = 0;
  let more = false;
  let elapsedMs = 0;
  const attempted = () => hashed + failed + deferred;

  for (;;) {
    if (opts.signal?.aborted) throw new HashAbortedError();
    if (attempted() >= maxAssets) {
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
      limit: Math.min(batchSize, maxAssets - attempted()),
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
      let result: AssetHashResult;
      const startedAt = Date.now();
      try {
        result = await hasher.hash(asset);
      } catch {
        result = { status: "unavailable" };
      }
      elapsedMs += Date.now() - startedAt;
      if (result.status === "hashed") {
        storeHash(db, asset.id, result.md5, opts.userId, now);
        hashed += 1;
      } else if (result.status === "remote") {
        // Not a failure and not progress — the bytes are simply somewhere else.
        // Park it so the pass moves on at full speed; the upload path will fetch
        // it once, if the user asked for this album to be backed up.
        deferHash(db, asset.id);
        deferred += 1;
      } else {
        failed += 1;
        // Mark attempted (hashed_at set, hash left NULL) so a permanently
        // unreadable asset isn't re-selected forever. Cleared on the next
        // modified_at change (upsertLocalAssets).
        db.run(sql`UPDATE local_asset SET hashed_at = ${now} WHERE id = ${asset.id}`);
      }
    }
    opts.onBatch?.({ hashed, failed, deferred });
    await yieldFn();
  }

  // The per-asset cost is in the message on purpose: it is the number that
  // exposed this bug (14726 ms for 8 photos) and the number that proves the fix.
  const attempts = attempted();
  const perAsset = attempts > 0 ? Math.round(elapsedMs / attempts) : 0;
  opts.log?.({
    op: "hash",
    level: "info",
    applied: hashed,
    message:
      `hashed ${hashed}, failed ${failed}, iCloud-deferred ${deferred}` +
      ` — ${elapsedMs}ms (${perAsset}ms/photo)`,
  });
  return { hashed, failed, deferred, more, elapsedMs };
}
