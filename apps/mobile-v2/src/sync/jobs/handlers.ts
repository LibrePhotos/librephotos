/**
 * The job handlers — one bounded unit of work per kind, plus the chaining rules
 * that keep the pipeline flowing.
 *
 * Every handler obeys the same contract:
 *   1. do a bounded slice of work (see the budgets in ./types),
 *   2. persist everything it learned (the tables are the state, not the stack),
 *   3. return the follow-up jobs, which the worker enqueues *after* recording
 *      this job's outcome.
 *
 * Chaining is where the starvation fix lives. A `device_scan` chunk enqueues the
 * next chunk **and** a `hash_batch`, so hashing starts on rows the scan has
 * already committed rather than waiting out the whole enumeration. A
 * `hash_batch` enqueues `upload_asset` jobs for the assets it just hashed **and**
 * its own continuation, so uploads begin during hashing rather than after it.
 * Nothing waits for a predecessor to *finish*; it only waits for a predecessor
 * to *produce something*.
 *
 * Pure: every side effect the app needs (network, expo native modules) arrives
 * through {@link JobSeams}, so the whole handler set is Node-tested with fakes.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import { clearMirror } from "@/db/reset";
import {
  getMetaNumber,
  setMeta,
  setMetaNumber,
  META_FAVORITE_MIN_RATING,
  META_LAST_INTEGRITY,
} from "@/db/queries/app-meta";
import { SYNC_ENTITIES, type SyncEntity } from "@/db/queries/sync-state";
import { checkIntegrity, type IntegrityReport } from "@/sync/integrity";
import { HASH_STATE_ICLOUD } from "@/sync/device/hasher";
import { LOCAL_FIRST } from "@/sync/upload/queue";
import { pullEntityStep, type PullOptions } from "@/sync/remote/delta";
import type { RemoteSyncSource } from "@/sync/remote/source";
import { jobSizer, type JobSizer } from "./sizing";
import type { JobContext, JobHandlers, JobOutcome } from "./worker";
import {
  GATE_RETRY_MS,
  HASH_BATCH_SIZE,
  OUTBOX_BUDGET,
  SCAN_CHUNK,
  THUMB_BATCH,
  UPLOAD_WINDOW,
  jobPayload,
  type JobPayloads,
  type JobSpec,
} from "./types";

export type OutboxReplayResult = { replayed: number; dropped: number; remaining: number };
export type ScanChunkResult = {
  /** False when the per-chunk budget cut the pass short; it resumes next chunk. */
  complete: boolean;
  added: number;
  scanned: number;
};
export type HashBatchResult = {
  hashed: number;
  failed: number;
  /** Assets left for the upload path to fetch from iCloud (never hashed here). */
  deferred?: number;
  /** True when un-hashed assets remain (or a scan may still produce some). */
  more: boolean;
};
export type UploadAssetResult = {
  uploaded: boolean;
  skipped: boolean;
  /** Set when the wifi/charging gate refused: retry later, don't burn attempts. */
  gated?: string;
  /**
   * The upload did not land. This has to be reported, not inferred: an upload
   * that neither uploaded nor skipped used to settle as a *successful* job with
   * `applied=0`, which is precisely how a server rejecting every completion
   * stayed invisible while the queue drained itself clean.
   */
  failed?: boolean;
  /** Why it failed — becomes the job's failure message in the sync log. */
  error?: string;
};
export type ThumbBatchResult = { fetched: number; more: boolean };

/**
 * Everything the handlers need from the outside world. All optional — an absent
 * seam simply makes its job a no-op, which is how the Node tests run a queue
 * with only the parts they care about wired up.
 */
export type JobSeams = {
  source: RemoteSyncSource;
  /** Server-side favorite_min_rating; a change forces a full reseed. */
  getFavoriteMinRating?: () => Promise<number | null>;
  replayOutbox?: (ctx: JobContext, budget: number) => Promise<OutboxReplayResult>;
  scanChunk?: (ctx: JobContext, budget: number) => Promise<ScanChunkResult>;
  hashBatch?: (ctx: JobContext, budget: number) => Promise<HashBatchResult>;
  uploadAsset?: (ctx: JobContext, assetId: string) => Promise<UploadAssetResult>;
  prefetchThumbs?: (ctx: JobContext, limit: number) => Promise<ThumbBatchResult>;
  /** True when the user has backup switched on (gates the hash→upload chain). */
  backupEnabled?: (db: AppDatabase) => boolean;
  /** Page size / progress reporting for the delta steps. */
  pull?: PullOptions;
  /** Skip the counts-vs-mirror integrity snapshot (repair does). */
  skipIntegrity?: boolean;
  /**
   * Budget overrides, for tests that want tiny chunks. An override also opts the
   * kind out of adaptive sizing, so a test's chosen size stays put.
   */
  budgets?: Partial<{
    outbox: number;
    scan: number;
    hash: number;
    thumbs: number;
    uploadWindow: number;
  }>;
  /** Work-unit sizer (defaults to the process-wide one). Injectable for tests. */
  sizer?: JobSizer;
  /** Sink for the integrity report so `syncAll` can put it in its result. */
  onIntegrity?: (report: IntegrityReport | null) => void;
  /** Sink for the outbox result, same reason. */
  onOutbox?: (result: OutboxReplayResult) => void;
  /** Sink for "the mirror was wiped and is reseeding". */
  onReseed?: () => void;
};

/* ---------------------------------------------------------------------- *
 * Upload window
 * ---------------------------------------------------------------------- */

/**
 * Enqueue `upload_asset` jobs for the next few assets the upload queue considers
 * eligible, up to the window size. Deliberately reads `upload_queue` rather than
 * taking ids from the caller: that table already owns eligibility, attempts and
 * backoff, and duplicating the rule here is how the two would drift apart.
 *
 * An unhashed row is an iCloud-only asset (`hash_state = 'icloud'`) whose bytes
 * the worker will fetch and hash in one go, so it is eligible — but it sorts
 * behind everything already on disk, so a network fetch never holds up photos
 * that are ready to go.
 */
export function enqueueUploadWindow(
  db: AppDatabase,
  now: number,
  limit = UPLOAD_WINDOW
): JobSpec[] {
  const rows = db.all(
    sql`SELECT uq.asset_id AS asset_id
        FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE uq.state IN ('pending', 'failed')
          AND (uq.next_attempt_at IS NULL OR uq.next_attempt_at <= ${now})
          AND (la.hash IS NOT NULL OR la.hash_state = ${HASH_STATE_ICLOUD})
          AND NOT EXISTS (
            SELECT 1 FROM job_queue j
            WHERE j.dedupe_key = 'upload_asset:' || uq.asset_id AND j.state IN ('pending', 'running')
          )
        ORDER BY ${LOCAL_FIRST}, uq.enqueued_at ASC, uq.asset_id ASC
        LIMIT ${limit}`
  ) as { asset_id: string }[];
  return rows.map((r) => ({ kind: "upload_asset" as const, payload: { assetId: r.asset_id } }));
}

/** How many `upload_asset` jobs are already live (keeps the window a window). */
function liveUploadJobs(db: AppDatabase): number {
  return (
    db.get(
      sql`SELECT COUNT(*) AS c FROM job_queue WHERE kind = 'upload_asset' AND state IN ('pending', 'running')`
    ) as { c: number }
  ).c;
}

/** Top up the upload window to `limit`, returning only the shortfall. */
function topUpUploadWindow(db: AppDatabase, now: number, limit: number): JobSpec[] {
  const shortfall = limit - liveUploadJobs(db);
  if (shortfall <= 0) return [];
  return enqueueUploadWindow(db, now, shortfall);
}

/* ---------------------------------------------------------------------- *
 * Handlers
 * ---------------------------------------------------------------------- */

/** The jobs a full sync consists of. `syncAll` enqueues exactly these. */
export function fullSyncJobs(opts: { skipIntegrity?: boolean } = {}): JobSpec[] {
  const jobs: JobSpec[] = [
    { kind: "outbox_replay" },
    { kind: "reseed_check" },
    // One per entity: they are independent units, so a stalled `sharing` pull
    // cannot hold up the photo feed the timeline is waiting on.
    ...SYNC_ENTITIES.map((entity) => ({
      kind: "remote_delta" as const,
      payload: { entity, page: 0 },
    })),
    { kind: "device_scan", payload: { chunk: 0 } },
    { kind: "hash_batch" },
    { kind: "thumb_prefetch" },
  ];
  if (!opts.skipIntegrity) jobs.push({ kind: "integrity_check" });
  return jobs;
}

/** The backup-only subset (the Backup tab's "Back up now"): no remote pull. */
export function backupJobs(): JobSpec[] {
  return [{ kind: "device_scan", payload: { chunk: 0 } }, { kind: "hash_batch" }];
}

export function createJobHandlers(seams: JobSeams): JobHandlers {
  const budgets = seams.budgets ?? {};
  const sizer = seams.sizer ?? jobSizer;

  return {
    /* -- 1. push local mutations before anything pulls over them ---------- */
    outbox_replay: async (ctx): Promise<JobOutcome> => {
      if (!seams.replayOutbox) return;
      const result = await seams.replayOutbox(ctx, budgets.outbox ?? OUTBOX_BUDGET);
      seams.onOutbox?.(result);
      // Only chain when the pass actually moved: a drain that stopped because
      // the server is unreachable must not spin the worker: the row's own
      // backoff, plus the next trigger, will bring it back.
      const progressed = result.replayed > 0 || result.dropped > 0;
      return {
        applied: result.replayed,
        note: `replayed ${result.replayed}, dropped ${result.dropped}, remaining ${result.remaining}`,
        enqueue: progressed && result.remaining > 0 ? [{ kind: "outbox_replay" }] : [],
      };
    },

    /* -- 2. favorite_min_rating change ⇒ the mirror must be rebuilt ------- */
    reseed_check: async (ctx): Promise<JobOutcome> => {
      if (!seams.getFavoriteMinRating) return;
      const current = await seams.getFavoriteMinRating();
      if (current == null) return; // network hiccup — skip the check this run
      const prev = getMetaNumber(ctx.db, META_FAVORITE_MIN_RATING);
      if (prev != null && prev !== current) {
        clearMirror(ctx.db);
        seams.onReseed?.();
        setMetaNumber(ctx.db, META_FAVORITE_MIN_RATING, current, ctx.now);
        ctx.log({ op: "reseed", level: "warn", message: `favorite_min_rating ${prev}→${current}` });
        // The cursors are gone, so every entity now needs a fresh seed.
        return {
          note: "reseed",
          enqueue: SYNC_ENTITIES.map((entity) => ({
            kind: "remote_delta" as const,
            payload: { entity, page: 0 },
          })),
        };
      }
      setMetaNumber(ctx.db, META_FAVORITE_MIN_RATING, current, ctx.now);
    },

    /* -- 3. one delta page per job (see delta.pullEntityStep) ------------- */
    remote_delta: async (ctx): Promise<JobOutcome> => {
      const payload = jobPayload<"remote_delta">(ctx.job) as Partial<JobPayloads["remote_delta"]> & {
        page?: number;
      };
      const entity = payload.entity as SyncEntity | undefined;
      if (!entity || !SYNC_ENTITIES.includes(entity)) return;
      const page = payload.page ?? 0;

      const step = await pullEntityStep(ctx.db, seams.source, entity, {
        ...seams.pull,
        signal: ctx.signal,
        now: ctx.now,
        log: ctx.log,
        // Progress counters restart only on the first page of a pass; a resumed
        // pass must keep the durable count or the seed bar would jump back to 0
        // on every app launch.
        resetProgress: page === 0,
      });

      return {
        applied: step.applied,
        deleted: step.deleted,
        note: step.reseeded
          ? `${entity}: cursor expired, reseeding`
          : `${entity} page ${page}: +${step.applied}/-${step.deleted}${step.done ? " (caught up)" : ""}`,
        enqueue: step.done
          ? []
          : [{ kind: "remote_delta", payload: { entity, page: page + 1 } as never }],
      };
    },

    /* -- 4. one chunk of the camera roll --------------------------------- */
    device_scan: async (ctx): Promise<JobOutcome> => {
      if (!seams.scanChunk) return;
      const { chunk = 0 } = jobPayload<"device_scan">(ctx.job);
      const budget = budgets.scan ?? sizer.budgetFor("device_scan") ?? SCAN_CHUNK;
      const startedAt = Date.now();
      const result = await seams.scanChunk(ctx, budget);
      // Only feed the controller when *it* chose the budget; an explicit override
      // (tests, repair flows) must not teach it about a size it did not pick.
      if (budgets.scan == null) sizer.observe("device_scan", Date.now() - startedAt);

      const next: JobSpec[] = [];
      // Hash what the scan has already committed — the whole point of splitting
      // the scan up. A hash_batch may well already be live, in which case the
      // dedupe key drops this one and nothing piles up.
      if (result.scanned > 0 || !result.complete) next.push({ kind: "hash_batch" });
      if (!result.complete) {
        next.push({ kind: "device_scan", payload: { chunk: chunk + 1 } as never });
      }
      return {
        applied: result.added,
        note: `chunk ${chunk} (budget ${budget}): scanned ${result.scanned}, +${result.added}${result.complete ? " (complete)" : ""}`,
        enqueue: next,
      };
    },

    /* -- 5. one batch of md5s, then hand the results to the uploader ------ */
    hash_batch: async (ctx): Promise<JobOutcome> => {
      if (!seams.hashBatch) return;
      const budget = budgets.hash ?? sizer.budgetFor("hash_batch") ?? HASH_BATCH_SIZE;
      const startedAt = Date.now();
      const result = await seams.hashBatch(ctx, budget);
      if (budgets.hash == null) sizer.observe("hash_batch", Date.now() - startedAt);

      const next: JobSpec[] = [];
      // Uploads must start *during* hashing, not after it. Every batch tops the
      // upload window up, so the first handful of hashed photos are already
      // uploading while the other 2800-odd are still being read.
      if (seams.backupEnabled?.(ctx.db) !== false) {
        next.push(...topUpUploadWindow(ctx.db, ctx.now, budgets.uploadWindow ?? UPLOAD_WINDOW));
      }
      if (result.more) next.push({ kind: "hash_batch" });

      const deferred = result.deferred ?? 0;
      return {
        applied: result.hashed,
        note:
          `hashed ${result.hashed}, failed ${result.failed}` +
          (deferred > 0 ? `, iCloud ${deferred}` : "") +
          ` (budget ${budget})${result.more ? "" : " (complete)"}`,
        enqueue: next,
      };
    },

    /* -- 6. one photo -------------------------------------------------- */
    upload_asset: async (ctx): Promise<JobOutcome> => {
      if (!seams.uploadAsset) return;
      const { assetId } = jobPayload<"upload_asset">(ctx.job);
      if (!assetId) return;

      const result = await seams.uploadAsset(ctx, assetId);
      const window = budgets.uploadWindow ?? UPLOAD_WINDOW;

      if (result.gated) {
        // Not a failure — the device is simply on cellular or off charge. Ask
        // again later without burning an attempt, and don't pull the next asset
        // forward: the whole stage is blocked, and the Backup screen says so.
        return {
          note: `gated: ${result.gated}`,
          enqueue: [
            {
              kind: "upload_asset",
              payload: { assetId } as never,
              notBefore: ctx.now + GATE_RETRY_MS,
            },
          ],
        };
      }

      // A rejected upload fails the *job*. Anything else is a lie the queue
      // tells itself: the item is still sitting in upload_queue with a failure
      // recorded, so reporting "done" here drains the window, logs applied=0 and
      // leaves nothing for the Sync screen to raise as a blocker.
      if (result.failed) {
        throw new Error(result.error ?? `upload failed for ${assetId}`);
      }

      const next: JobSpec[] = topUpUploadWindow(ctx.db, ctx.now, window);
      // A landed upload means new server rows: pull a photos delta so the
      // merged-timeline badge flips from pending to synced (doc 03 §5).
      if (result.uploaded) next.push({ kind: "remote_delta", payload: { entity: "photo", page: 0 } as never });

      return {
        applied: result.uploaded ? 1 : 0,
        note: result.uploaded ? `uploaded ${assetId}` : result.skipped ? `already on server` : undefined,
        enqueue: next,
      };
    },

    /* -- 7. grid thumbnails for the freshly-pulled timeline --------------- */
    thumb_prefetch: async (ctx): Promise<JobOutcome> => {
      if (!seams.prefetchThumbs) return;
      const budget = budgets.thumbs ?? sizer.budgetFor("thumb_prefetch") ?? THUMB_BATCH;
      const startedAt = Date.now();
      const result = await seams.prefetchThumbs(ctx, budget);
      if (budgets.thumbs == null) sizer.observe("thumb_prefetch", Date.now() - startedAt);
      return {
        note: result.fetched > 0 ? `prefetched ${result.fetched}` : undefined,
        enqueue: result.more ? [{ kind: "thumb_prefetch" }] : [],
      };
    },

    /* -- 8. counts vs the mirror; drift schedules a targeted reseed ------- */
    integrity_check: async (ctx): Promise<JobOutcome> => {
      if (seams.skipIntegrity) return;
      let report: IntegrityReport | null = null;
      try {
        const server = await seams.source.counts();
        report = checkIntegrity(ctx.db, server);
      } catch {
        // A failed counts fetch is non-fatal — the next run retries. Swallowed
        // rather than thrown so it does not consume the job's attempt budget.
        ctx.log({ op: "integrity", level: "warn", message: "counts fetch failed" });
        return;
      }
      seams.onIntegrity?.(report);
      setMeta(ctx.db, META_LAST_INTEGRITY, JSON.stringify({ at: ctx.now, ok: report.ok }), ctx.now);
      if (report.ok) {
        ctx.log({ op: "integrity", level: "info", message: "ok" });
        return;
      }
      const drifted: JobSpec[] = [];
      for (const drift of report.drifts) {
        scheduleReseed(ctx.db, drift.entity);
        drifted.push({ kind: "remote_delta", payload: { entity: drift.entity, page: 0 } as never });
        ctx.log({
          op: "integrity",
          entity: drift.entity,
          level: "error",
          applied: drift.local,
          message: `drift local=${drift.local} server=${drift.server} — reseed scheduled`,
        });
      }
      return { note: `drift on ${report.drifts.length} entity/ies`, enqueue: drifted };
    },
  };
}

/**
 * Mark an entity for reseed on the next pull by clearing its cursor. The rows
 * stay put (so the UI keeps showing stale-but-present data) until the reseed
 * replaces them from zero.
 */
export function scheduleReseed(db: AppDatabase, entity: SyncEntity): void {
  db.run(
    sql`UPDATE sync_state SET cursor_id = NULL, cursor_modified = NULL, status = 'idle' WHERE entity = ${entity}`
  );
}
