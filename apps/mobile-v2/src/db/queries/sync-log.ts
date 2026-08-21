/**
 * sync_log ring-buffer accessors (doc 03 §8). Structured diagnostics for sync
 * runs — one row per meaningful step. Capped in code (oldest rows pruned) so the
 * table stays a bounded ring; surfaced on the Sync status screen and exportable
 * for bug reports.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

/** Max rows retained in the ring buffer. */
export const SYNC_LOG_CAP = 500;

export type SyncLogLevel = "info" | "warn" | "error";

export type SyncLogEntry = {
  op: string;
  entity?: string | null;
  level?: SyncLogLevel;
  applied?: number | null;
  deleted?: number | null;
  durationMs?: number | null;
  cursor?: string | null;
  message?: string | null;
};

export type SyncLogRow = {
  id: number;
  ts: number;
  op: string | null;
  entity: string | null;
  level: string;
  applied: number | null;
  deleted: number | null;
  duration_ms: number | null;
  cursor: string | null;
  message: string | null;
};

/** Append one entry and prune the ring to SYNC_LOG_CAP rows. */
export function appendSyncLog(
  db: AppDatabase,
  entry: SyncLogEntry,
  now = Date.now(),
  cap = SYNC_LOG_CAP
): void {
  db.run(
    sql`INSERT INTO sync_log (ts, op, entity, level, applied, deleted, duration_ms, cursor, message)
        VALUES (${now}, ${entry.op}, ${entry.entity ?? null}, ${entry.level ?? "info"},
          ${entry.applied ?? null}, ${entry.deleted ?? null}, ${entry.durationMs ?? null},
          ${entry.cursor ?? null}, ${entry.message ?? null})`
  );
  // Keep only the most recent `cap` rows (prune by id, which is monotonic).
  db.run(
    sql`DELETE FROM sync_log WHERE id <= (
          SELECT id FROM sync_log ORDER BY id DESC LIMIT 1 OFFSET ${cap}
        )`
  );
}

/** Most recent log rows, newest first. */
export function recentSyncLog(db: AppDatabase, limit = 200): SyncLogRow[] {
  return db.all(
    sql`SELECT id, ts, op, entity, level, applied, deleted, duration_ms, cursor, message
        FROM sync_log ORDER BY id DESC LIMIT ${limit}`
  ) as SyncLogRow[];
}

export function clearSyncLog(db: AppDatabase): void {
  db.run(sql`DELETE FROM sync_log`);
}
