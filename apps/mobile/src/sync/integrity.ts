/**
 * Post-sync integrity check (doc 03 §8). Compares local mirror row counts
 * against the server `/api/sync/counts/` endpoint. Drift beyond tolerance means
 * the mirror diverged (a missed tombstone, an aborted apply, a server-side bulk
 * op we mis-tracked) — the affected entities are scheduled for reseed and the
 * event is logged loudly.
 */
import type { SyncCounts } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { localCounts, type LocalCounts } from "@/db/queries/counts";
import type { SyncEntity } from "@/db/queries/sync-state";

/** Absolute per-entity count difference tolerated before a reseed is scheduled. */
export const INTEGRITY_TOLERANCE = 0;

/** Map a counts key onto the sync entity whose mirror it reflects. */
const COUNT_KEY_TO_ENTITY: Record<keyof LocalCounts, SyncEntity> = {
  photos: "photo",
  persons: "person",
  user_albums: "user_album",
  auto_albums: "auto_album",
  thing_albums: "thing_album",
  place_albums: "place_album",
  tags: "tag_album",
};

export type IntegrityDrift = {
  key: keyof LocalCounts;
  entity: SyncEntity;
  local: number;
  server: number;
};

export type IntegrityReport = {
  ok: boolean;
  drifts: IntegrityDrift[];
  local: LocalCounts;
};

/** Compare local counts to a server counts payload. Pure — no side effects. */
export function checkIntegrity(
  db: AppDatabase,
  server: SyncCounts,
  tolerance = INTEGRITY_TOLERANCE
): IntegrityReport {
  const local = localCounts(db);
  const drifts: IntegrityDrift[] = [];
  for (const key of Object.keys(COUNT_KEY_TO_ENTITY) as (keyof LocalCounts)[]) {
    const l = local[key];
    const s = server[key] ?? 0;
    if (Math.abs(l - s) > tolerance) {
      drifts.push({ key, entity: COUNT_KEY_TO_ENTITY[key], local: l, server: s });
    }
  }
  return { ok: drifts.length === 0, drifts, local };
}
