/**
 * What the queue is doing, in the three terms the Sync status and Backup
 * screens have to answer at a glance:
 *
 *   **which stage is running**  → {@link jobQueueSnapshot}.inFlight + depth
 *   **how far along it is**     → {@link syncStages}, every fraction against a
 *                                 real, fixed denominator
 *   **what is blocking it**     → {@link jobQueueSnapshot}.failures, each with
 *                                 its own error text and retry window
 *
 * The denominator rule is not cosmetic. The screen this replaces showed
 * `on_server / hashed` — a fraction whose *denominator grew as hashing
 * proceeded* — so on a 2867-photo library it read "0/161" and the maintainer had
 * to ask what it meant. Every total below is a count of work that already
 * exists (rows in the mirror, assets the provider reported), never a count of
 * work discovered so far.
 *
 * Pure SQL, so every state is Node-testable.
 */
import { sql } from "drizzle-orm";
import { queueSummary, type AppDatabase } from "@librephotos/local-db";
import { JOB_KINDS, MAX_JOB_ATTEMPTS, type JobKind } from "./types";

export type QueueDepth = {
  kind: JobKind;
  pending: number;
  running: number;
  failed: number;
  done: number;
};

export type InFlightJob = {
  id: number;
  kind: JobKind;
  payload: string | null;
  startedAt: number | null;
  attempts: number;
};

export type JobFailure = {
  id: number;
  kind: JobKind;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  /** True once the attempt cap is spent: this will not retry on its own. */
  terminal: boolean;
};

export type JobQueueSnapshot = {
  /** One entry per kind that has any row at all, in priority order. */
  depth: QueueDepth[];
  inFlight: InFlightJob[];
  failures: JobFailure[];
  totals: { pending: number; running: number; done: number; failed: number };
  /** Earliest moment a pending job becomes claimable (a backoff window). */
  nextDueAt: number | null;
};

/** The snapshot of an empty queue (before the first read). */
export const EMPTY_JOB_QUEUE_SNAPSHOT: JobQueueSnapshot = Object.freeze({
  depth: [],
  inFlight: [],
  failures: [],
  totals: { pending: 0, running: 0, done: 0, failed: 0 },
  nextDueAt: null,
});

const KIND_ORDER = new Map<string, number>(JOB_KINDS.map((k, i) => [k, i]));

/** Everything the status screens need about the queue, in one pass. */
export async function jobQueueSnapshot(db: AppDatabase, limit = 20): Promise<JobQueueSnapshot> {
  const rows = await db.all<{ kind: JobKind; state: string; c: number; }>(sql`SELECT kind, state, COUNT(*) AS c FROM job_queue GROUP BY kind, state`);

  const byKind = new Map<JobKind, QueueDepth>();
  const totals = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) {
    const entry =
      byKind.get(r.kind) ?? { kind: r.kind, pending: 0, running: 0, failed: 0, done: 0 };
    if (r.state === "pending" || r.state === "running" || r.state === "done" || r.state === "failed") {
      entry[r.state] = r.c;
      totals[r.state] += r.c;
    }
    byKind.set(r.kind, entry);
  }

  const depth = [...byKind.values()].sort(
    (a, b) => (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99)
  );

  const inFlight = await db.all<{ id: number; kind: JobKind; payload: string | null; started_at: number | null; attempts: number }>(
    sql`SELECT id, kind, payload, started_at, attempts FROM job_queue
        WHERE state = 'running' ORDER BY started_at ASC`
  );

  // Both terminal failures and jobs sitting out a backoff window: a job that has
  // errored is worth naming even while it still intends to retry, because
  // "nothing is happening and nothing says why" is the bug this screen exists to
  // prevent.
  const failures = await db.all<{ id: number; kind: JobKind; attempts: number; last_error: string | null; next_attempt_at: number; state: string; }>(
    sql`SELECT id, kind, attempts, last_error, next_attempt_at, state FROM job_queue
        WHERE last_error IS NOT NULL AND state IN ('pending', 'failed')
        ORDER BY (state = 'failed') DESC, next_attempt_at ASC
        LIMIT ${limit}`
  );

  const nextDue = await db.get<{ at: number | null } | undefined>(
    sql`SELECT MIN(next_attempt_at) AS at FROM job_queue WHERE state = 'pending'`
  );

  return {
    depth,
    inFlight: inFlight.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      startedAt: r.started_at,
      attempts: r.attempts,
    })),
    failures: failures.map((r) => ({
      id: r.id,
      kind: r.kind,
      attempts: r.attempts,
      lastError: r.last_error,
      nextAttemptAt: r.next_attempt_at,
      terminal: r.state === "failed" || r.attempts >= MAX_JOB_ATTEMPTS,
    })),
    totals,
    nextDueAt: nextDue?.at ?? null,
  };
}

/* ---------------------------------------------------------------------- *
 * Per-stage progress — real totals only
 * ---------------------------------------------------------------------- */

export type StageKey = "remote" | "scan" | "hash" | "upload" | "thumbs";

export type StageProgress = {
  stage: StageKey;
  done: number;
  /** A count of work that already exists. Never grows as the stage discovers it. */
  total: number;
  /** Units that will never complete (unreadable files, permanently failed rows). */
  stuck: number;
  /** Jobs of this stage waiting or running right now. */
  queued: number;
  active: boolean;
};

/**
 * Camera-roll scan progress. The denominator is the provider's own library
 * count, captured on `local_album.asset_count` when the album list is resolved —
 * i.e. the real 2867, available before a single asset has been enumerated. The
 * synthetic whole-library album is by construction the largest, so `MAX` picks
 * it without needing to hard-code its id here.
 */
export async function scanCounts(db: AppDatabase): Promise<{ scanned: number; total: number }> {
  const scanned = (await db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM local_asset`)).c;
  const reported = (
    await db.get<{ c: number }>(sql`SELECT COALESCE(MAX(asset_count), 0) AS c FROM local_album`)
  ).c;
  // Membership can legitimately exceed the library album (assets in user albums
  // the library pass has not reached yet), so the total is the larger of the two
  // rather than a number the progress bar could overshoot.
  return { scanned, total: Math.max(reported, scanned) };
}

/**
 * Hash progress over the device library. Videos are excluded: they are hashed
 * lazily at upload time, so counting them would put a denominator on screen that
 * the pass never intends to reach.
 */
export async function hashCounts(db: AppDatabase): Promise<{ hashed: number; total: number; unreadable: number }> {
  const row = await db.get<{ total: number; hashed: number | null; unreadable: number | null }>(
    sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN hash IS NOT NULL THEN 1 ELSE 0 END) AS hashed,
               SUM(CASE WHEN hash IS NULL AND hashed_at IS NOT NULL THEN 1 ELSE 0 END) AS unreadable
        FROM local_asset WHERE type <> 'video'`
  );
  return {
    hashed: row?.hashed ?? 0,
    total: row?.total ?? 0,
    unreadable: row?.unreadable ?? 0,
  };
}

/** Remote mirror progress, summed over every entity's determinate seed total. */
export async function remoteCounts(db: AppDatabase): Promise<{ applied: number; total: number }> {
  const row = await db.get<{ applied: number; total: number }>(
    sql`SELECT COALESCE(SUM(progress_current), 0) AS applied,
               COALESCE(SUM(MAX(progress_total, progress_current)), 0) AS total
        FROM sync_state`
  );
  return { applied: row?.applied ?? 0, total: row?.total ?? 0 };
}

/** Thumb cache coverage of the visible timeline. */
export async function thumbCounts(db: AppDatabase): Promise<{ cached: number; total: number }> {
  const row = await db.get<{ total: number; cached: number | null }>(
    sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN EXISTS (SELECT 1 FROM thumb_cache tc WHERE tc.photo_id = rp.id) THEN 1 ELSE 0 END) AS cached
        FROM remote_photo rp
        WHERE rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0 AND rp.archived = 0
          AND rp.timestamp IS NOT NULL`
  );
  return { cached: row?.cached ?? 0, total: row?.total ?? 0 };
}

/**
 * Every stage, each with its own fixed denominator and its own queue depth, so
 * a screen can render the whole pipeline at once and the user can see which part
 * is moving. This is the answer to "which stage is running, how far along, and
 * what is blocking it" — the three questions the device run could not answer.
 */
export async function syncStages(db: AppDatabase, given?: JobQueueSnapshot): Promise<StageProgress[]> {
  const snapshot = given ?? await jobQueueSnapshot(db);
  const depthOf = (kind: JobKind) => {
    const d = snapshot.depth.find((x) => x.kind === kind);
    return { queued: (d?.pending ?? 0) + (d?.running ?? 0), active: (d?.running ?? 0) > 0 };
  };

  const remote = await remoteCounts(db);
  const scan = await scanCounts(db);
  const hash = await hashCounts(db);
  const upload = await queueSummary(db);
  const thumbs = await thumbCounts(db);

  const remoteDepth = depthOf("remote_delta");
  const scanDepth = depthOf("device_scan");
  const hashDepth = depthOf("hash_batch");
  const uploadDepth = depthOf("upload_asset");
  const thumbDepth = depthOf("thumb_prefetch");

  return [
    {
      stage: "remote",
      done: remote.applied,
      total: remote.total,
      stuck: 0,
      queued: remoteDepth.queued,
      active: remoteDepth.active,
    },
    {
      stage: "scan",
      done: scan.scanned,
      total: scan.total,
      stuck: 0,
      queued: scanDepth.queued,
      active: scanDepth.active,
    },
    {
      stage: "hash",
      done: hash.hashed,
      total: hash.total,
      stuck: hash.unreadable,
      queued: hashDepth.queued,
      active: hashDepth.active,
    },
    {
      stage: "upload",
      done: upload.done + upload.skipped_exists,
      total: upload.total,
      stuck: upload.failed,
      queued: uploadDepth.queued,
      active: uploadDepth.active,
    },
    {
      stage: "thumbs",
      done: thumbs.cached,
      total: thumbs.total,
      stuck: 0,
      queued: thumbDepth.queued,
      active: thumbDepth.active,
    },
  ];
}
