/**
 * `job_queue` table ops — pure SQL, no expo, no network, fully Node-tested.
 *
 * Deliberately the same shape as the two durable queues that already work
 * (`outbox` via mutations/outbox and `upload_queue` via sync/upload/queue):
 * attempts + `next_attempt_at` backoff, `last_error`, and a boot-time reclaim of
 * rows a killed process left mid-flight. The worker (./worker) drives the state
 * machine; this module owns the rows.
 *
 *   pending ──claim──▶ running ──ok──▶ done
 *      ▲                  │
 *      │                  ├──retryable──▶ pending (attempts+1, backoff window)
 *      │                  ├──exhausted──▶ failed  (terminal, last_error kept)
 *      └───reclaim────────┘  (process died while running)
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import {
  JOB_PRIORITY,
  MAX_JOB_ATTEMPTS,
  dedupeKeyFor,
  jobBackoffDelay,
  type JobKind,
  type JobRow,
  type JobSpec,
} from "./types";

/**
 * Enqueue one job. Returns the new row id, or `null` when an identical live job
 * already exists (the dedupe case — the overwhelmingly common one, since every
 * trigger, foreground event and chained job re-requests the same work).
 *
 * The `WHERE NOT EXISTS` and the partial unique index in the schema say the same
 * thing; the guard here makes the drop silent and reportable rather than an
 * exception, and the index makes it impossible to get wrong from elsewhere.
 */
export function enqueueJob(db: AppDatabase, spec: JobSpec, now = Date.now()): number | null {
  const key = spec.dedupeKey ?? dedupeKeyFor(spec.kind, spec.payload);
  const priority = spec.priority ?? JOB_PRIORITY[spec.kind];
  const payload = spec.payload ? JSON.stringify(spec.payload) : null;
  const notBefore = spec.notBefore ?? 0;

  db.run(
    sql`INSERT INTO job_queue (kind, dedupe_key, payload, state, priority, attempts, next_attempt_at, created_at)
        SELECT ${spec.kind}, ${key}, ${payload}, 'pending', ${priority}, 0, ${notBefore}, ${now}
        WHERE NOT EXISTS (
          SELECT 1 FROM job_queue WHERE dedupe_key = ${key} AND state IN ('pending', 'running')
        )`
  );
  const row = db.get(sql`SELECT changes() AS n, last_insert_rowid() AS id`) as {
    n: number;
    id: number;
  };
  return row.n > 0 ? row.id : null;
}

/** Enqueue many; returns how many were actually inserted (the rest deduped). */
export function enqueueJobs(db: AppDatabase, specs: JobSpec[], now = Date.now()): number {
  let inserted = 0;
  for (const spec of specs) {
    if (enqueueJob(db, spec, now) != null) inserted += 1;
  }
  return inserted;
}

/**
 * Atomically claim the next eligible job, or null when none is ready.
 *
 * The SELECT and the UPDATE run inside one transaction and the UPDATE re-asserts
 * `state = 'pending'`, so a claim either wins outright or yields nothing — two
 * workers can never both be handed the same row. (JS is single-threaded, but the
 * worker awaits inside its loop, so two loops *do* interleave between statements;
 * the transaction is what makes that safe.)
 *
 * Order: priority, then the backoff window, then insertion order. That is
 * exactly the index `idx_job_queue_ready` covers.
 */
export function claimNextJob(db: AppDatabase, now = Date.now()): JobRow | null {
  return db.transaction((tx) => {
    const candidate = tx.get(
      sql`SELECT id FROM job_queue
          WHERE state = 'pending' AND next_attempt_at <= ${now}
          ORDER BY priority ASC, next_attempt_at ASC, id ASC
          LIMIT 1`
    ) as { id: number } | undefined;
    if (!candidate) return null;

    tx.run(
      sql`UPDATE job_queue
          SET state = 'running', started_at = ${now}, attempts = attempts + 1
          WHERE id = ${candidate.id} AND state = 'pending'`
    );
    const changed = (tx.get(sql`SELECT changes() AS n`) as { n: number }).n;
    if (changed === 0) return null; // lost the race — the caller loops.

    return (tx.get(
      sql`SELECT id, kind, dedupe_key, payload, state, priority, attempts, next_attempt_at,
                 created_at, started_at, finished_at, last_error
          FROM job_queue WHERE id = ${candidate.id}`
    ) as JobRow | undefined) ?? null;
  }) as JobRow | null;
}

/** Success: park the row as `done` and clear any stale error. */
export function completeJob(db: AppDatabase, id: number, now = Date.now()): void {
  db.run(
    sql`UPDATE job_queue SET state = 'done', finished_at = ${now}, last_error = NULL
        WHERE id = ${id}`
  );
}

export type FailOutcome = { state: "pending" | "failed"; retryAt: number | null };

/**
 * Record a failure. Under the attempt cap the job goes back to `pending` behind
 * an exponential backoff window; at the cap it becomes terminal `failed` with
 * `last_error` preserved, which is what the status screens surface as the
 * blocker. `attempts` was already incremented by the claim.
 */
export function failJob(
  db: AppDatabase,
  row: Pick<JobRow, "id" | "attempts">,
  error: string,
  now = Date.now(),
  maxAttempts = MAX_JOB_ATTEMPTS
): FailOutcome {
  if (row.attempts >= maxAttempts) {
    db.run(
      sql`UPDATE job_queue SET state = 'failed', finished_at = ${now}, last_error = ${error}
          WHERE id = ${row.id}`
    );
    return { state: "failed", retryAt: null };
  }
  const retryAt = now + jobBackoffDelay(row.attempts);
  db.run(
    sql`UPDATE job_queue
        SET state = 'pending', started_at = NULL, next_attempt_at = ${retryAt}, last_error = ${error}
        WHERE id = ${row.id}`
  );
  return { state: "pending", retryAt };
}

/**
 * Hand a claimed job back untouched — used when the worker is cancelled
 * mid-flight. Cancellation is not the job's fault, so the attempt is refunded;
 * otherwise backgrounding the app a few times would exhaust every job's budget.
 */
export function releaseJob(db: AppDatabase, id: number): void {
  db.run(
    sql`UPDATE job_queue
        SET state = 'pending', started_at = NULL, attempts = MAX(attempts - 1, 0)
        WHERE id = ${id} AND state = 'running'`
  );
}

/**
 * Boot reclaim: a `running` row can only be the residue of a process that died
 * (the app was killed, the JS context reloaded), because a live worker owns at
 * most `JOB_CONCURRENCY` of them and releases on exit. Revert them to `pending`
 * so work resumes instead of wedging — the same recovery `reclaimStaleInflight`
 * does for the outbox.
 *
 * `staleMs` defaults to 0 ("reclaim everything"), which is right at process
 * start. Pass a threshold to sweep mid-session without disturbing live jobs.
 * The attempt is refunded, exactly as for cancellation: a crash is not evidence
 * that the job is bad.
 */
export function reclaimStaleJobs(db: AppDatabase, now = Date.now(), staleMs = 0): number {
  const cutoff = now - staleMs;
  const n = (
    db.get(
      sql`SELECT COUNT(*) AS c FROM job_queue
          WHERE state = 'running' AND (started_at IS NULL OR started_at <= ${cutoff})`
    ) as { c: number }
  ).c;
  if (n === 0) return 0;
  db.run(
    sql`UPDATE job_queue
        SET state = 'pending', started_at = NULL, attempts = MAX(attempts - 1, 0)
        WHERE state = 'running' AND (started_at IS NULL OR started_at <= ${cutoff})`
  );
  return n;
}

/** Reset terminal failures back to pending (the user's "retry" affordance). */
export function retryFailedJobs(db: AppDatabase, kind?: JobKind): number {
  const kindFilter = kind ? sql` AND kind = ${kind}` : sql``;
  const n = (
    db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'failed'${kindFilter}`) as {
      c: number;
    }
  ).c;
  if (n === 0) return 0;
  // A failed row may collide with a live row carrying the same dedupe key (the
  // work was already re-requested). Drop those instead of resurrecting them —
  // the live row is the newer, better copy.
  db.run(
    sql`DELETE FROM job_queue WHERE state = 'failed'${kindFilter}
        AND EXISTS (SELECT 1 FROM job_queue live
                    WHERE live.dedupe_key = job_queue.dedupe_key AND live.state IN ('pending', 'running'))`
  );
  db.run(
    sql`UPDATE job_queue
        SET state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL,
            started_at = NULL, finished_at = NULL
        WHERE state = 'failed'${kindFilter}`
  );
  return n;
}

/** How many jobs could still run (pending, whether or not their window is open). */
export function pendingJobCount(db: AppDatabase): number {
  return (
    db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state IN ('pending', 'running')`) as {
      c: number;
    }
  ).c;
}

/** Whether anything is claimable right now (drives the worker's exit condition). */
export function hasEligibleJob(db: AppDatabase, now = Date.now()): boolean {
  const row = db.get(
    sql`SELECT 1 AS x FROM job_queue WHERE state = 'pending' AND next_attempt_at <= ${now} LIMIT 1`
  ) as { x: number } | undefined;
  return row != null;
}

/** Earliest ms-epoch at which a pending job becomes claimable, or null if none. */
export function nextJobDueAt(db: AppDatabase): number | null {
  const row = db.get(
    sql`SELECT MIN(next_attempt_at) AS at FROM job_queue WHERE state = 'pending'`
  ) as { at: number | null } | undefined;
  return row?.at ?? null;
}

/**
 * Keep the finished-job history bounded. `done` rows are pure diagnostics (the
 * sync_log carries the durable narrative), so they age out; `failed` rows stay
 * until the user retries them, because they are the only record of a blocker.
 */
export function pruneJobs(db: AppDatabase, keep = 200): number {
  const n = (db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'done'`) as { c: number })
    .c;
  if (n <= keep) return 0;
  db.run(
    sql`DELETE FROM job_queue WHERE state = 'done' AND id NOT IN (
          SELECT id FROM job_queue WHERE state = 'done' ORDER BY id DESC LIMIT ${keep}
        )`
  );
  return n - keep;
}

/** Remove every live job (used by repair, which re-enqueues from a clean slate). */
export function clearJobs(db: AppDatabase): void {
  db.run(sql`DELETE FROM job_queue`);
}

/** One job row by id (tests + the status screen's in-flight detail). */
export function getJob(db: AppDatabase, id: number): JobRow | null {
  return (
    (db.get(
      sql`SELECT id, kind, dedupe_key, payload, state, priority, attempts, next_attempt_at,
                 created_at, started_at, finished_at, last_error
          FROM job_queue WHERE id = ${id}`
    ) as JobRow | undefined) ?? null
  );
}
