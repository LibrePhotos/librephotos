import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_BACKOFF_MS = 15_000;

export type OutboxEntry = {
  id: number;
  created_at: number;
  kind: string;
  payload: string | null;
  state: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: number | null;
};

export type OutboxCounts = { pending: number; inflight: number; failed: number; rejected: number };

const ENTRY_COLUMNS = sql`id, created_at, kind, payload, state, attempts, last_error, next_attempt_at`;

export async function enqueueOutboxEntry(
  db: AppDatabase,
  kind: string,
  payload: unknown,
  opts: { key?: string; now?: number } = {}
): Promise<number> {
  const now = opts.now ?? Date.now();
  const body = JSON.stringify(opts.key === undefined ? payload : { key: opts.key, payload });
  const insert = db.get<{ id: number } | undefined>(
    sql`INSERT INTO outbox (created_at, kind, payload, state, attempts) VALUES (${now}, ${kind}, ${body}, 'pending', 0)
        RETURNING id`
  );
  if (opts.key === undefined) {
    const row = await insert;
    if (!row) throw new Error("outbox insert returned no id");
    return row.id;
  }
  const [, row] = await db.batch([
    db.run(
      sql`DELETE FROM outbox WHERE kind = ${kind} AND state IN ('pending', 'failed', 'rejected')
          AND json_extract(payload, '$.key') = ${opts.key}`
    ),
    insert,
  ]);
  if (!row) throw new Error("outbox insert returned no id");
  return row.id;
}

export function outboxPayload(entry: Pick<OutboxEntry, "payload">): unknown {
  if (entry.payload == null) return null;
  const value: unknown = JSON.parse(entry.payload);
  if (typeof value === "object" && value !== null && "key" in value && "payload" in value) return value.payload;
  return value;
}

export async function claimOutboxEntry(db: AppDatabase, now = Date.now()): Promise<OutboxEntry | null> {
  const row = await db.get<OutboxEntry | undefined>(
    sql`UPDATE outbox SET state = 'inflight', inflight_at = ${now}
        WHERE id = (SELECT id FROM outbox
                    WHERE state = 'pending'
                       OR (state = 'failed' AND attempts < ${OUTBOX_MAX_ATTEMPTS}
                           AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
                    ORDER BY id LIMIT 1)
        RETURNING ${ENTRY_COLUMNS}`
  );
  return row ?? null;
}

export async function completeOutboxEntry(db: AppDatabase, id: number): Promise<void> {
  await db.run(sql`DELETE FROM outbox WHERE id = ${id}`);
}

export async function retryOutboxEntry(
  db: AppDatabase,
  id: number,
  error: string,
  now = Date.now(),
  backoffMs = OUTBOX_BACKOFF_MS
): Promise<void> {
  await db.run(
    sql`UPDATE outbox SET state = 'failed', attempts = attempts + 1, last_error = ${error}, inflight_at = NULL,
          next_attempt_at = ${now} + ${backoffMs} * (1 << MIN(attempts, 10))
        WHERE id = ${id}`
  );
}

export async function requeueOutboxEntry(db: AppDatabase, id: number): Promise<void> {
  await db.run(sql`UPDATE outbox SET state = 'pending', inflight_at = NULL WHERE id = ${id}`);
}

export async function rejectOutboxEntry(db: AppDatabase, id: number, error: string): Promise<void> {
  await db.run(
    sql`UPDATE outbox SET state = 'rejected', attempts = attempts + 1, last_error = ${error}, inflight_at = NULL
        WHERE id = ${id}`
  );
}

export async function resetInflightOutbox(db: AppDatabase): Promise<number> {
  const rows = await db.all<{ id: number }>(
    sql`UPDATE outbox SET state = 'pending', inflight_at = NULL WHERE state = 'inflight' RETURNING id`
  );
  return rows.length;
}

export async function retryStuckOutbox(db: AppDatabase): Promise<number> {
  const rows = await db.all<{ id: number }>(
    sql`UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = NULL
        WHERE state IN ('failed', 'rejected') RETURNING id`
  );
  return rows.length;
}

export async function outboxCounts(db: AppDatabase, kinds?: readonly string[]): Promise<OutboxCounts> {
  const scope = kinds && kinds.length > 0 ? sql`WHERE kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const rows = await db.all<{ state: string; c: number }>(
    sql`SELECT state, COUNT(*) AS c FROM outbox ${scope} GROUP BY state`
  );
  const counts: OutboxCounts = { pending: 0, inflight: 0, failed: 0, rejected: 0 };
  for (const r of rows) {
    if (r.state === "pending" || r.state === "inflight" || r.state === "failed" || r.state === "rejected") {
      counts[r.state] = r.c;
    }
  }
  return counts;
}

export function outboxEntries(db: AppDatabase, kinds: readonly string[]): Promise<OutboxEntry[]> {
  return db.all<OutboxEntry>(
    sql`SELECT ${ENTRY_COLUMNS} FROM outbox WHERE kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        ORDER BY id`
  );
}
