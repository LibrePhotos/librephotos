/**
 * Mirror reset (pure SQL, no migrator). Clears the remote-mirror tables and
 * sync cursors so a fresh full seed can repopulate them — e.g. when the user's
 * favorite_min_rating changes (is_favorite must be re-materialized, doc 02 §1).
 * outbox / upload_queue / local media are intentionally left intact.
 */
import { sql } from "drizzle-orm";
import { runBatch } from "./batch";
import { MIGRATIONS_TABLE } from "./migrate";
import type { AppDatabase } from "./types";
import type { SyncEntity } from "./queries/sync-state";

const MIRROR_TABLES = [
  "remote_photo",
  "remote_photo_detail",
  "person",
  "user_album",
  "user_album_photo",
  "auto_album",
  "auto_album_photo",
  "thing_album",
  "place_album",
  "tag_album",
  "shared_from_me",
  "shared_user",
] as const;

export async function clearMirror(db: AppDatabase): Promise<void> {
  await runBatch(db, [...MIRROR_TABLES.map((table) => sql.raw(`DELETE FROM ${table}`)), sql`DELETE FROM sync_state`]);
}

/** The mirror tables (and their membership tables) each entity owns. */
const ENTITY_TABLES: Record<SyncEntity, string[]> = {
  photo: ["remote_photo", "remote_photo_detail"],
  person: ["person"],
  user_album: ["user_album", "user_album_photo"],
  auto_album: ["auto_album", "auto_album_photo"],
  thing_album: ["thing_album"],
  place_album: ["place_album"],
  tag_album: ["tag_album"],
  sharing: ["shared_user", "shared_from_me"],
};

/**
 * Clear a single entity's mirror tables and reset its sync cursor — used for a
 * targeted reseed (server `410 cursor_expired`) without discarding the whole
 * mirror. The entity is re-pulled from cursor zero afterwards.
 */
export async function clearEntity(db: AppDatabase, entity: SyncEntity): Promise<void> {
  await runBatch(db, [
    ...ENTITY_TABLES[entity].map((table) => sql.raw(`DELETE FROM ${table}`)),
    sql`DELETE FROM sync_state WHERE entity = ${entity}`,
  ]);
}

export async function wipeLocalData(db: AppDatabase): Promise<void> {
  const tables = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'local_asset_fts%'
          AND name <> ${MIGRATIONS_TABLE}`
  );
  await runBatch(db, [
    ...tables.map(({ name }) => sql`DELETE FROM ${sql.identifier(name)}`),
    sql`DELETE FROM local_asset_fts`,
  ]);
}
