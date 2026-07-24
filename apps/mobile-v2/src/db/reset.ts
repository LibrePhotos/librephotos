/**
 * Mirror reset (pure SQL, no migrator). Clears the remote-mirror tables and
 * sync cursors so a fresh full seed can repopulate them — e.g. when the user's
 * favorite_min_rating changes (is_favorite must be re-materialized, doc 02 §1).
 * outbox / upload_queue / local media are intentionally left intact.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "./types";

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
