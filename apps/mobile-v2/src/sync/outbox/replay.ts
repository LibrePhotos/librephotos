/**
 * Outbox replay — Phase 4 (offline mutations, doc 03 §6). This is the STUB that
 * reserves step 1 of the orchestrator sequence: local mutations must be pushed
 * to the server BEFORE the delta pull, so a pull never clobbers an un-synced
 * optimistic change (replay-first / last-write-wins with server authority).
 *
 * Phase 4 will:
 *   1. Read `outbox` rows FIFO where state = 'pending'.
 *   2. Call the matching api-client mutation for each (favorite/hide/trash/
 *      rating/album add-remove/person rename/caption).
 *   3. Success → delete the row. 4xx → drop the row + surface a toast (next
 *      delta restores server truth). Network error → keep + back off.
 *   4. Only after the outbox is drained for an entity may that entity's delta
 *      pull run (the orchestrator already sequences replay before pull).
 *
 * Until then this is a no-op that reports an empty queue, so wiring it into the
 * orchestrator today is harmless.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { OutboxReplayResult, SyncStepContext } from "../orchestrator";

/** Count of pending outbox rows (used by the status screen + Phase 4). */
export function pendingOutboxCount(db: AppDatabase): number {
  const row = db.get(sql`SELECT COUNT(*) AS c FROM outbox WHERE state = 'pending'`) as
    | { c: number }
    | undefined;
  return row?.c ?? 0;
}

/**
 * No-op replay for this phase. Returns the current pending count so the
 * orchestrator result reflects reality once Phase 4 fills in the body.
 */
export async function replayOutbox(ctx: SyncStepContext): Promise<OutboxReplayResult> {
  const remaining = pendingOutboxCount(ctx.db);
  return { replayed: 0, dropped: 0, remaining };
}
