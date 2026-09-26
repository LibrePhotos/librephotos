/**
 * Mirror reset (pure SQL, no migrator). Clears the remote-mirror tables and
 * sync cursors so a fresh full seed can repopulate them — e.g. when the user's
 * favorite_min_rating changes (is_favorite must be re-materialized, doc 02 §1).
 * outbox / upload_queue / local media are intentionally left intact.
 */
import { sql } from "drizzle-orm";
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

export function clearMirror(db: AppDatabase): void {
  for (const table of MIRROR_TABLES) db.run(sql.raw(`DELETE FROM ${table}`));
  db.run(sql`DELETE FROM sync_state`);
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
export function clearEntity(db: AppDatabase, entity: SyncEntity): void {
  for (const table of ENTITY_TABLES[entity]) db.run(sql.raw(`DELETE FROM ${table}`));
  db.run(sql`DELETE FROM sync_state WHERE entity = ${entity}`);
}
