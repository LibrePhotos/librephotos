/**
 * Sync orchestrator (doc 03 §1). `syncAll()` runs a single-flight, cancellable
 * sequence:
 *
 *   1. Replay outbox        (push local mutations first — Phase 4 stub)
 *   2. Remote delta pull     (per entity, dependency order — this phase)
 *   3. Device media sync     (camera roll diff — Phase 3 stub)
 *   4. Hash pass             (new/changed local assets — Phase 3 stub)
 *   5. Upload queue top-up   (backup engine — Phase 5 stub)
 *   6. Thumb prefetch        (fill thumb_cache for new remote photos — wired hook)
 *   7. Integrity snapshot    (counts vs local; drift ⇒ schedule reseed)
 *
 * The core is pure: it takes a `RemoteSyncSource` and a bag of injected step
 * hooks (all optional, default no-op) so the whole sequence — single-flight
 * mutex, cancellation, favorite_min_rating reseed, integrity drift — is
 * unit-tested under Node with a fake source. The app wiring (real api-client
 * source, thumb prefetch, later-phase steps) lives in ./run.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import { clearMirror } from "@/db/reset";
import {
  getSyncState,
  SYNC_ENTITIES,
  type SyncEntity,
} from "@/db/queries/sync-state";
import { appendSyncLog, type SyncLogEntry } from "@/db/queries/sync-log";
import {
  getMetaNumber,
  setMetaNumber,
  setMeta,
  META_FAVORITE_MIN_RATING,
  META_LAST_INTEGRITY,
} from "@/db/queries/app-meta";
import type { RemoteSyncSource } from "./remote/source";
import { pullAll, SyncAbortedError, type PullOptions, type SyncProgress } from "./remote/delta";
import { checkIntegrity, type IntegrityReport } from "./integrity";

export type SyncReason = "login" | "foreground" | "refresh" | "connectivity" | "outbox" | "manual";

export type OutboxReplayResult = { replayed: number; dropped: number; remaining: number };

/** Context handed to each injected step hook. */
export type SyncStepContext = {
  db: AppDatabase;
  source: RemoteSyncSource;
  signal?: AbortSignal;
  now: number;
  log: (entry: SyncLogEntry) => void;
};

export type SyncHooks = {
  /** Current server-side favorite_min_rating; a change forces a full reseed. */
  getFavoriteMinRating?: () => Promise<number | null>;
  /** Step 1 — replay offline mutations before pulling (Phase 4). */
  replayOutbox?: (ctx: SyncStepContext) => Promise<OutboxReplayResult>;
  /** Step 3 — camera-roll diff into local_asset tables (Phase 3). */
  syncDeviceMedia?: (ctx: SyncStepContext) => Promise<void>;
  /** Step 4 — hash new/changed local assets (Phase 3). */
  hashAssets?: (ctx: SyncStepContext) => Promise<void>;
  /** Step 5 — top up the upload queue if backup is enabled (Phase 5). */
  topUpUploadQueue?: (ctx: SyncStepContext) => Promise<void>;
  /** Step 6 — prefetch grid thumbnails for new remote photos (Phase 1, wired). */
  prefetchThumbs?: (ctx: SyncStepContext) => Promise<void>;
};

export type SyncAllOptions = PullOptions &
  SyncHooks & {
    reason?: SyncReason;
    /** Skip the favorite_min_rating check + integrity (used by repairSync). */
    skipIntegrity?: boolean;
  };

export type SyncResult = {
  reason: SyncReason;
  applied: number;
  deleted: number;
  reseeded: boolean;
  integrity: IntegrityReport | null;
  outbox: OutboxReplayResult | null;
  durationMs: number;
};

/** Whether a first full seed is still needed (photo mirror never completed). */
export function needsInitialSeed(db: AppDatabase): boolean {
  return getSyncState(db, "photo")?.status !== "done";
}

let inFlight: Promise<SyncResult> | null = null;
let controller: AbortController | null = null;
let lastRunAt = 0;

/** Timestamp (ms) of the last completed or attempted syncAll. */
export function lastSyncRunAt(): number {
  return lastRunAt;
}

/** True while a syncAll is in progress. */
export function isSyncing(): boolean {
  return inFlight != null;
}

/** Cancel the in-flight sync (if any). Safe to call when idle. */
export function cancelSync(): void {
  controller?.abort();
}

/**
 * Run the full sync sequence. Single-flight: concurrent callers share the one
 * in-flight run. Cancellable via {@link cancelSync}. The caller's `signal` is
 * linked to the shared controller.
 */
export function syncAll(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions = {}
): Promise<SyncResult> {
  if (inFlight) return inFlight;
  controller = new AbortController();
  const signal = controller.signal;
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller?.abort(), { once: true });
  }

  inFlight = runSequence(db, source, { ...opts, signal }).finally(() => {
    inFlight = null;
    controller = null;
    lastRunAt = Date.now();
  });
  return inFlight;
}

async function runSequence(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions
): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const reason = opts.reason ?? "foreground";
  const wallStart = Date.now();
  const log = (entry: SyncLogEntry) => appendSyncLog(db, entry, Date.now());
  const ctx: SyncStepContext = { db, source, signal: opts.signal, now, log };
  const pullOpts: PullOptions = {
    signal: opts.signal,
    now,
    pageSize: opts.pageSize,
    onProgress: opts.onProgress,
    log,
  };

  log({ op: "run", level: "info", message: `start:${reason}` });

  // 1. Replay outbox first so pulls don't clobber un-pushed local mutations.
  let outbox: OutboxReplayResult | null = null;
  if (opts.replayOutbox) outbox = await opts.replayOutbox(ctx);

  // Reseed trigger: favorite_min_rating changed (is_favorite must be
  // re-materialized from a clean pull, doc 02 §1 / 03 §3).
  let reseeded = false;
  if (opts.getFavoriteMinRating) {
    const current = await opts.getFavoriteMinRating();
    if (current != null) {
      const prev = getMetaNumber(db, META_FAVORITE_MIN_RATING);
      if (prev != null && prev !== current) {
        clearMirror(db);
        reseeded = true;
        log({ op: "reseed", level: "warn", message: `favorite_min_rating ${prev}→${current}` });
      }
      setMetaNumber(db, META_FAVORITE_MIN_RATING, current, now);
    }
  }

  // 2. Remote delta pull, per entity in dependency order.
  const pull = await pullAll(db, source, pullOpts);

  // 3–6. Device media / hashing / upload / thumb prefetch (later phases; the
  // hooks are no-ops until those phases wire them in).
  if (opts.syncDeviceMedia) await opts.syncDeviceMedia(ctx);
  if (opts.hashAssets) await opts.hashAssets(ctx);
  if (opts.topUpUploadQueue) await opts.topUpUploadQueue(ctx);
  if (opts.prefetchThumbs) await opts.prefetchThumbs(ctx);

  // 7. Integrity snapshot: counts endpoint vs local. Drift ⇒ schedule reseed.
  let integrity: IntegrityReport | null = null;
  if (!opts.skipIntegrity) {
    try {
      const server = await source.counts();
      integrity = checkIntegrity(db, server);
      setMeta(db, META_LAST_INTEGRITY, JSON.stringify({ at: now, ok: integrity.ok }), now);
      if (!integrity.ok) {
        for (const drift of integrity.drifts) {
          scheduleReseed(db, drift.entity);
          log({
            op: "integrity",
            entity: drift.entity,
            level: "error",
            applied: drift.local,
            message: `drift local=${drift.local} server=${drift.server} — reseed scheduled`,
          });
        }
      } else {
        log({ op: "integrity", level: "info", message: "ok" });
      }
    } catch {
      // A failed counts fetch is non-fatal — the next run retries.
      log({ op: "integrity", level: "warn", message: "counts fetch failed" });
    }
  }

  const result: SyncResult = {
    reason,
    applied: pull.applied,
    deleted: pull.deleted,
    reseeded,
    integrity,
    outbox,
    durationMs: Date.now() - wallStart,
  };
  log({
    op: "run",
    level: "info",
    applied: pull.applied,
    deleted: pull.deleted,
    durationMs: result.durationMs,
    message: `done:${reason}`,
  });
  return result;
}

/**
 * Mark an entity for reseed on the next run by clearing its cursor. The entity's
 * rows are left in place (so the UI keeps showing stale-but-present data) until
 * the reseed pull replaces them from zero.
 */
function scheduleReseed(db: AppDatabase, entity: SyncEntity): void {
  // Clearing the cursor makes the next pullEntity treat it as a seed.
  db.run(
    sql`UPDATE sync_state SET cursor_id = NULL, cursor_modified = NULL, status = 'idle' WHERE entity = ${entity}`
  );
}

/**
 * Manual "Repair sync": wipe the whole mirror and re-seed from zero. Used by the
 * Sync status screen's Repair button and by unrecoverable schema/drift states.
 */
export async function repairSync(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions = {}
): Promise<SyncResult> {
  clearMirror(db);
  appendSyncLog(db, { op: "reseed", level: "warn", message: "manual repair" }, Date.now());
  return syncAll(db, source, { ...opts, reason: "manual" });
}

export { SyncAbortedError, SYNC_ENTITIES };
export type { SyncProgress };
