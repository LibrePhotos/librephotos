// DeletionLog tombstones the albums_tags writes leave for mobile sync (port
// of the Postgres half of lp_db::write::deletion_log). deleted_at is
// clock_timestamp(), not now(): a tombstone must sort after the
// last_modified bumps of the same request. Only rows for existing users.
import { sql, type SQL } from "drizzle-orm";
import { pgArray, rows } from "~/lib/db";
import type { Exec } from "./common";

export const ENTITY = { albumUser: "album_user", albumAuto: "album_auto", tag: "tag" } as const;

function insertPairs(entity: string, pairs: SQL): SQL {
  return sql`INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at)
    SELECT ${entity}, v.eid, v.uid, clock_timestamp() FROM (${pairs}) v
    WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid`;
}

const ALBUMS = {
  album_user: ["api_albumuser", "api_albumuser_shared_to", "albumuser_id"],
  album_auto: ["api_albumauto", "api_albumauto_shared_to", "albumauto_id"],
} as const;

/** Albums `ids` are about to be deleted: tombstones for owner + recipients. */
export async function albumsDeleted(tx: Exec, entity: "album_user" | "album_auto", ids: number[]) {
  if (!ids.length) return;
  const [album, through, fk] = ALBUMS[entity].map((s) => sql.raw(s));
  const arr = pgArray(ids, "int");
  await rows(
    insertPairs(
      entity,
      sql`SELECT a.id::text AS eid, a.owner_id AS uid FROM ${album} a WHERE a.id = ANY(${arr})
          UNION SELECT s.${fk}::text, s.user_id FROM ${through} s WHERE s.${fk} = ANY(${arr})`,
    ),
    tx,
  );
}

/** Tags `ids` are about to be deleted: one tombstone for the owner. */
export async function tagsDeleted(tx: Exec, ids: number[]) {
  if (!ids.length) return;
  await rows(
    insertPairs(ENTITY.tag, sql`SELECT t.id::text AS eid, t.owner_id AS uid FROM api_tag t WHERE t.id = ANY(${pgArray(ids, "int")})`),
    tx,
  );
}

/** Visibility loss: one tombstone per (entity id, user). */
export async function unshared(tx: Exec, entity: string, entityIds: string[], userIds: number[]) {
  if (!entityIds.length || !userIds.length) return;
  await rows(
    insertPairs(
      entity,
      sql`SELECT e AS eid, u AS uid FROM unnest(${pgArray(entityIds, "text")}) e, unnest(${pgArray(userIds, "int")}) u`,
    ),
    tx,
  );
}

/** clear_tombstones: the row became visible again to userIds. */
export async function clearTombstones(tx: Exec, entity: string, entityIds: string[], userIds: number[]) {
  if (!entityIds.length || !userIds.length) return;
  await rows(
    sql`DELETE FROM api_deletionlog WHERE entity = ${entity} AND entity_id = ANY(${pgArray(entityIds, "text")})
        AND owner_id = ANY(${pgArray(userIds, "int")})`,
    tx,
  );
}
