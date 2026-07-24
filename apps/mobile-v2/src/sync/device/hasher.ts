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
import type { AssetHasher, LocalMediaType } from "./types";

export const HASH_BATCH = 50;

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
};

export type HashResult = { hashed: number; failed: number };

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

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
  const now = opts.now ?? Date.now();
  const yieldFn = opts.yield ?? defaultYield;
  let hashed = 0;
  let failed = 0;

  for (;;) {
    if (opts.signal?.aborted) throw new HashAbortedError();
    const batch = selectUnhashed(db, {
      includeVideos: opts.includeVideos,
      selectedOnly: opts.selectedOnly,
      limit: batchSize,
    });
    if (batch.length === 0) break;

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
    await yieldFn();
  }

  opts.log?.({ op: "hash", level: "info", applied: hashed, message: `hashed ${hashed}, failed ${failed}` });
  return { hashed, failed };
}
