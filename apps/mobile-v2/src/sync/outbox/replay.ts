/**
 * Outbox replay core (doc 03 §6) — the PURE engine, Node-tested with a fake
 * executor. Drains the `outbox` FIFO through an injected {@link OutboxExecutor}:
 *
 *   - success            → delete the row (next delta pull restores server truth)
 *   - 4xx (client error) → drop the row + log + push a toast (mutation invalid)
 *   - network / 5xx      → keep + backoff, and STOP the pass (server unreachable)
 *
 * Crash-safety: a pass first reclaims rows stuck `inflight` past the stale
 * threshold. The orchestrator sequences this step BEFORE the delta pull, so a
 * pull never clobbers an un-pushed optimistic change (replay-first, doc 03 §1).
 *
 * The app wiring (real api-client executor + toast store) lives in ./executor;
 * this module imports nothing from expo, so it stays in the Node test project.
 */
import { sql } from "drizzle-orm";
import { ApiError } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import {
  AlbumAddPayload,
  AlbumCreatePayload,
  AlbumRemovePayload,
  AlbumRenamePayload,
  CaptionPayload,
  FavoritePayload,
  HidePayload,
  PersonRenamePayload,
  RatingPayload,
  TrashPayload,
  type OutboxKind,
  type OutboxRow,
} from "@/mutations/types";
import {
  deleteOutboxRow,
  dropOutboxRow,
  failOutboxRow,
  markInflight,
  nextOutboxRow,
  pendingOutboxCount,
  reclaimStaleInflight,
} from "@/mutations/outbox";

export { pendingOutboxCount };

/** The seam the replay engine pushes each mutation through. */
export interface OutboxExecutor {
  favorite(p: { imageHashes: string[]; favorite: boolean }): Promise<void>;
  hide(p: { imageHashes: string[]; hidden: boolean }): Promise<void>;
  trash(p: { imageHashes: string[]; deleted: boolean }): Promise<void>;
  rating(p: { imageHash: string; rating: number }): Promise<void>;
  caption(p: { imageHash: string; caption: string }): Promise<void>;
  albumAdd(p: { albumId: number; title: string; photoIds: string[] }): Promise<void>;
  albumRemove(p: { albumId: number; imageHashes: string[] }): Promise<void>;
  /** Returns the server-assigned album id, for temp-id reconciliation. */
  albumCreate(p: { title: string; photoIds: string[] }): Promise<{ id: number }>;
  albumRename(p: { albumId: number; title: string }): Promise<void>;
  personRename(p: { personId: number; name: string }): Promise<void>;
}

export type ReplayToast = { level: "error"; kind: OutboxKind; message: string };

export type DrainOptions = {
  now?: () => number;
  signal?: AbortSignal;
  log?: (entry: SyncLogEntry) => void;
  /** Surface a dropped (4xx) mutation to the user. */
  onToast?: (toast: ReplayToast) => void;
  /** Cap on rows processed per pass (background time budget). */
  maxRows?: number;
};

export type OutboxReplayResult = { replayed: number; dropped: number; remaining: number };

/** True for a hard client error we should NOT retry (drop the row). */
function isPermanent(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  // 408/429 are retryable despite being 4xx; everything else 4xx is permanent.
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

/**
 * Reconcile a temp (offline-created) album against its server id: remap the
 * mirror rows AND rewrite any still-pending outbox payloads that reference the
 * temp id, so chained offline edits (add/remove/rename) target the real album.
 */
export function reconcileTempAlbum(db: AppDatabase, tempId: number, realId: number): void {
  if (tempId === realId) return;
  const temp = db.get(
    sql`SELECT title, owner_id, shared, favorited, cover_hash, created_on, last_modified
        FROM user_album WHERE id = ${tempId}`
  ) as
    | {
        title: string;
        owner_id: number | null;
        shared: number;
        favorited: number;
        cover_hash: string | null;
        created_on: number | null;
        last_modified: number | null;
      }
    | undefined;

  if (temp) {
    // Upsert the album row under the real id (merge onto an already-synced row).
    db.run(
      sql`INSERT INTO user_album (id, title, owner_id, shared, favorited, cover_hash, photo_count, created_on, last_modified)
          VALUES (${realId}, ${temp.title}, ${temp.owner_id}, ${temp.shared}, ${temp.favorited},
                  ${temp.cover_hash}, 0, ${temp.created_on}, ${temp.last_modified})
          ON CONFLICT(id) DO NOTHING`
    );
    // Move membership across, then drop the temp album.
    db.run(
      sql`INSERT OR IGNORE INTO user_album_photo (album_id, photo_id, ordering)
          SELECT ${realId}, photo_id, ordering FROM user_album_photo WHERE album_id = ${tempId}`
    );
    db.run(sql`DELETE FROM user_album_photo WHERE album_id = ${tempId}`);
    db.run(sql`DELETE FROM user_album WHERE id = ${tempId}`);
    db.run(
      sql`UPDATE user_album SET photo_count = (SELECT COUNT(*) FROM user_album_photo WHERE album_id = ${realId})
          WHERE id = ${realId}`
    );
  }

  // Rewrite pending outbox rows still pointing at the temp album.
  const rows = db.all(
    sql`SELECT id, kind, payload FROM outbox
        WHERE kind IN ('album_add', 'album_remove', 'album_rename') AND payload IS NOT NULL`
  ) as { id: number; kind: string; payload: string }[];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as { albumId?: number };
      if (p.albumId === tempId) {
        p.albumId = realId;
        db.run(sql`UPDATE outbox SET payload = ${JSON.stringify(p)} WHERE id = ${r.id}`);
      }
    } catch {
      // Unparseable payload — skip; replay will drop it as a 4xx later.
    }
  }
}

/** Parse + dispatch one row to the executor. `albumCreate` reconciles the id. */
async function execRow(db: AppDatabase, executor: OutboxExecutor, row: OutboxRow): Promise<void> {
  const raw = row.payload ? (JSON.parse(row.payload) as unknown) : {};
  switch (row.kind as OutboxKind) {
    case "favorite":
      return executor.favorite(FavoritePayload.parse(raw));
    case "hide":
      return executor.hide(HidePayload.parse(raw));
    case "trash":
      return executor.trash(TrashPayload.parse(raw));
    case "rating":
      return executor.rating(RatingPayload.parse(raw));
    case "caption":
      return executor.caption(CaptionPayload.parse(raw));
    case "album_add": {
      const p = AlbumAddPayload.parse(raw);
      return executor.albumAdd({ albumId: p.albumId, title: p.title, photoIds: p.photoIds });
    }
    case "album_remove": {
      const p = AlbumRemovePayload.parse(raw);
      return executor.albumRemove({ albumId: p.albumId, imageHashes: p.imageHashes });
    }
    case "album_create": {
      const p = AlbumCreatePayload.parse(raw);
      const { id } = await executor.albumCreate({ title: p.title, photoIds: p.photoIds });
      reconcileTempAlbum(db, p.tempId, id);
      return;
    }
    case "album_rename": {
      const p = AlbumRenamePayload.parse(raw);
      return executor.albumRename(p);
    }
    case "person_rename": {
      const p = PersonRenamePayload.parse(raw);
      return executor.personRename(p);
    }
  }
}

/**
 * Drain the outbox once. Returns counts; the orchestrator surfaces them in
 * `SyncResult.outbox`. Stops early on a network error (server unreachable) or
 * when the row/time budget is exhausted.
 */
export async function drainOutbox(
  db: AppDatabase,
  executor: OutboxExecutor,
  opts: DrainOptions = {}
): Promise<OutboxReplayResult> {
  const now = opts.now ?? Date.now;
  const maxRows = opts.maxRows ?? Infinity;
  let replayed = 0;
  let dropped = 0;

  reclaimStaleInflight(db, now());

  let processed = 0;
  for (;;) {
    if (opts.signal?.aborted) break;
    if (processed >= maxRows) break;
    const row = nextOutboxRow(db, now());
    if (!row) break;
    processed += 1;
    markInflight(db, row.id, now());
    try {
      await execRow(db, executor, row);
      deleteOutboxRow(db, row.id);
      replayed += 1;
    } catch (err) {
      if (isPermanent(err)) {
        dropOutboxRow(db, row.id);
        dropped += 1;
        const message = err instanceof Error ? err.message : String(err);
        opts.log?.({ op: "replay", entity: row.kind, level: "error", message: `dropped: ${message}` });
        opts.onToast?.({ level: "error", kind: row.kind as OutboxKind, message });
      } else {
        // Transient (network / 5xx): keep + backoff, and stop — the rest will
        // fail the same way until connectivity returns.
        const message = err instanceof Error ? err.message : String(err);
        failOutboxRow(db, row.id, message, now());
        opts.log?.({ op: "replay", entity: row.kind, level: "warn", message: `retry: ${message}` });
        break;
      }
    }
  }

  const remaining = pendingOutboxCount(db);
  if (replayed > 0 || dropped > 0) {
    opts.log?.({ op: "replay", level: "info", applied: replayed, message: `replayed ${replayed}, dropped ${dropped}, remaining ${remaining}` });
  }
  return { replayed, dropped, remaining };
}
