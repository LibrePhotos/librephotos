/**
 * Outbox table ops (doc 03 §6). Pure SQL over the `outbox` table — no expo, no
 * network. The mutation actions (./actions) enqueue rows inside the same
 * transaction as the optimistic mirror write; the replay engine
 * (sync/outbox/replay) drains them FIFO through the api-client.
 *
 * State machine (mirrors the upload queue, doc 03 §5):
 *
 *   pending → inflight → (success ⇒ row deleted)
 *                     ↘ 4xx      ⇒ row dropped (+ sync_log + toast)
 *                     ↘ network  ⇒ failed (backoff) → pending (retry window)
 *
 * Crash-safety: a row left `inflight` by a killed process is reclaimed to
 * `pending` once it is older than a threshold, so replay never wedges.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@librephotos/local-db";
import { OUTBOX_SCHEMAS, type OutboxKind, type OutboxPayload, type OutboxRow } from "./types";

/** Cap on retry attempts before a row is parked as permanently failed. */
export const MAX_ATTEMPTS = 8;
/** Backoff base (ms): delay = base * 2^attempts. */
export const BACKOFF_BASE_MS = 15_000;
/** An `inflight` row older than this (ms) is presumed crashed and reclaimed. */
export const INFLIGHT_STALE_MS = 60_000;

export function backoffDelay(attempts: number, base = BACKOFF_BASE_MS): number {
  return base * 2 ** Math.max(0, attempts);
}

/**
 * Validate + insert one outbox row. Runs inside the caller's transaction (the
 * optimistic mirror write) so the row and the write commit atomically — a
 * failed validation throws and rolls both back. Returns the new row id.
 */
/**
 * The validated outbox insert, as one statement (`RETURNING id`), for a caller
 * to put in the same batch as its optimistic mirror write (./actions) so both
 * commit atomically. Validation happens here, before anything runs: a bad
 * payload throws and nothing is written.
 */
export function enqueueOutboxSql<K extends OutboxKind>(kind: K, payload: OutboxPayload<K>, now = Date.now()): SQL {
  // Validate against the kind's schema — a bad payload must never reach replay.
  const parsed = OUTBOX_SCHEMAS[kind].parse(payload);
  return sql`INSERT INTO outbox (created_at, kind, payload, state, attempts)
             VALUES (${now}, ${kind}, ${JSON.stringify(parsed)}, 'pending', 0)
             RETURNING id`;
}

/** Validate + insert one outbox row on its own. Returns the new row id. */
export async function enqueueOutbox<K extends OutboxKind>(
  db: AppDatabase,
  kind: K,
  payload: OutboxPayload<K>,
  now = Date.now()
): Promise<number> {
  const row = await db.get<{ id: number } | undefined>(enqueueOutboxSql(kind, payload, now));
  if (!row) throw new Error("outbox insert returned no id");
  return row.id;
}

/** Count of rows that still need to be pushed (pending + failed + inflight). */
export async function pendingOutboxCount(db: AppDatabase): Promise<number> {
  const row = await db.get<{ c: number }>(
    sql`SELECT COUNT(*) AS c FROM outbox WHERE state IN ('pending', 'failed', 'inflight')`
  );
  return row.c;
}

export type OutboxSummary = { pending: number; inflight: number; failed: number; total: number };

export const EMPTY_OUTBOX_SUMMARY: OutboxSummary = Object.freeze({ pending: 0, inflight: 0, failed: 0, total: 0 });

export async function outboxSummary(db: AppDatabase): Promise<OutboxSummary> {
  const rows = await db.all<{ state: string; c: number; }>(sql`SELECT state, COUNT(*) AS c FROM outbox GROUP BY state`);
  const s: OutboxSummary = { pending: 0, inflight: 0, failed: 0, total: 0 };
  for (const r of rows) {
    if (r.state === "pending") s.pending = r.c;
    else if (r.state === "inflight") s.inflight = r.c;
    else if (r.state === "failed") s.failed = r.c;
    s.total += r.c;
  }
  return s;
}

/**
 * Reclaim rows stuck `inflight` past the stale threshold (a crash mid-replay).
 * Returns the number reclaimed. Called once at the start of a replay pass.
 */
export async function reclaimStaleInflight(
  db: AppDatabase,
  now = Date.now(),
  staleMs = INFLIGHT_STALE_MS
): Promise<number> {
  const cutoff = now - staleMs;
  const before = (
    await db.get<{ c: number }>(
      sql`SELECT COUNT(*) AS c FROM outbox WHERE state = 'inflight' AND (inflight_at IS NULL OR inflight_at <= ${cutoff})`
    )
  ).c;
  await db.run(
    sql`UPDATE outbox SET state = 'pending', inflight_at = NULL
        WHERE state = 'inflight' AND (inflight_at IS NULL OR inflight_at <= ${cutoff})`
  );
  return before;
}

/**
 * The next row eligible to replay: a `pending` row, or a `failed` row under the
 * attempt cap whose backoff window has passed. Oldest first (FIFO by id).
 */
export async function nextOutboxRow(db: AppDatabase, now = Date.now()): Promise<OutboxRow | null> {
  const row = await db.get<OutboxRow | undefined>(
    sql`SELECT id, created_at, kind, payload, state, attempts, last_error, inflight_at, next_attempt_at
        FROM outbox
        WHERE state = 'pending'
           OR (state = 'failed' AND attempts < ${MAX_ATTEMPTS}
               AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
        ORDER BY id ASC
        LIMIT 1`
  );
  return row ?? null;
}

export async function markInflight(db: AppDatabase, id: number, now = Date.now()): Promise<void> {
  await db.run(sql`UPDATE outbox SET state = 'inflight', inflight_at = ${now} WHERE id = ${id}`);
}

/** Success — remove the row (server truth arrives on the next delta). */
export async function deleteOutboxRow(db: AppDatabase, id: number): Promise<void> {
  await db.run(sql`DELETE FROM outbox WHERE id = ${id}`);
}

/** Permanent drop (4xx): the mutation is invalid; the next delta restores truth. */
export async function dropOutboxRow(db: AppDatabase, id: number): Promise<void> {
  await db.run(sql`DELETE FROM outbox WHERE id = ${id}`);
}

/** Transient failure (network/5xx): bump attempts, set the backoff window. */
export async function failOutboxRow(
  db: AppDatabase,
  id: number,
  error: string,
  now = Date.now(),
  base = BACKOFF_BASE_MS
): Promise<void> {
  const attempts =
    ((await db.get<{ attempts: number } | undefined>(sql`SELECT attempts FROM outbox WHERE id = ${id}`))
      ?.attempts ?? 0) + 1;
  await db.run(
    sql`UPDATE outbox
        SET state = 'failed', attempts = ${attempts}, last_error = ${error},
            inflight_at = NULL, next_attempt_at = ${now + backoffDelay(attempts, base)}
        WHERE id = ${id}`
  );
}

/** Rows for the sync-status screen (newest first). */
export async function outboxList(db: AppDatabase, limit = 100): Promise<OutboxRow[]> {
  return await db.all<OutboxRow>(
    sql`SELECT id, created_at, kind, payload, state, attempts, last_error, inflight_at, next_attempt_at
        FROM outbox ORDER BY id DESC LIMIT ${limit}`
  );
}
