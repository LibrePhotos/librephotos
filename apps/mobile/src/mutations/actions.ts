import { sql, type SQL } from "drizzle-orm";
import { getMetaNumber, META_FAVORITE_MIN_RATING, type AppDatabase } from "@librephotos/local-db";
import { isRecord, parseJson } from "@/lib/guards";
import { enqueueOutboxSql } from "./outbox";

/** LibrePhotos default when the server threshold hasn't been synced yet. */
export const DEFAULT_FAVORITE_MIN_RATING = 4;

export type MutationResult = { outboxId: number };

async function favoriteMinRating(db: AppDatabase): Promise<number> {
  return (await getMetaNumber(db, META_FAVORITE_MIN_RATING)) ?? DEFAULT_FAVORITE_MIN_RATING;
}

function inList(values: string[]): SQL {
  // Build a safe parameterized `(?, ?, …)` list.
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

async function mutate(db: AppDatabase, writes: SQL[], outbox: SQL): Promise<number> {
  const [row] = await db.batch([db.get<{ id: number } | undefined>(outbox), ...writes.map((w) => db.run(w))]);
  if (!row) throw new Error("outbox insert returned no id");
  return row.id;
}

/* ---- photo flag mutations ---------------------------------------------- */

export async function favoritePhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; favorite: boolean },
  now = Date.now()
): Promise<MutationResult> {
  const threshold = await favoriteMinRating(db);
  const rating = args.favorite ? threshold : 0;
  const outboxId = await mutate(
    db,
    [
      sql`UPDATE remote_photo SET is_favorite = ${args.favorite ? 1 : 0}, rating = ${rating}
          WHERE image_hash IN (${inList(args.imageHashes)})`,
    ],
    enqueueOutboxSql("favorite", { imageHashes: args.imageHashes, favorite: args.favorite }, now)
  );
  return { outboxId };
}

export async function hidePhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; hidden: boolean },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [sql`UPDATE remote_photo SET hidden = ${args.hidden ? 1 : 0} WHERE image_hash IN (${inList(args.imageHashes)})`],
    enqueueOutboxSql("hide", { imageHashes: args.imageHashes, hidden: args.hidden }, now)
  );
  return { outboxId };
}

export async function trashPhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; deleted: boolean },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [
      sql`UPDATE remote_photo SET in_trashcan = ${args.deleted ? 1 : 0}
          WHERE image_hash IN (${inList(args.imageHashes)})`,
    ],
    enqueueOutboxSql("trash", { imageHashes: args.imageHashes, deleted: args.deleted }, now)
  );
  return { outboxId };
}

/** Archive / unarchive (#545): archived photos leave the timeline but stay in albums and search. */
export async function archivePhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; archived: boolean },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [
      sql`UPDATE remote_photo SET archived = ${args.archived ? 1 : 0}
          WHERE image_hash IN (${inList(args.imageHashes)})`,
    ],
    enqueueOutboxSql("archive", { imageHashes: args.imageHashes, archived: args.archived }, now)
  );
  return { outboxId };
}

export async function ratePhoto(
  db: AppDatabase,
  args: { imageHash: string; rating: number },
  now = Date.now()
): Promise<MutationResult> {
  const threshold = await favoriteMinRating(db);
  const isFavorite = args.rating >= threshold ? 1 : 0;
  const outboxId = await mutate(
    db,
    [
      sql`UPDATE remote_photo SET rating = ${args.rating}, is_favorite = ${isFavorite}
          WHERE image_hash = ${args.imageHash}`,
    ],
    enqueueOutboxSql("rating", { imageHash: args.imageHash, rating: args.rating }, now)
  );
  return { outboxId };
}

async function patchedDetail(
  db: AppDatabase,
  imageHash: string,
  caption: string
): Promise<{ photoId: string; payload: string } | null> {
  const row = await db.get<{ photo_id: string; payload: string } | undefined>(
    sql`SELECT d.photo_id AS photo_id, d.payload AS payload
        FROM remote_photo rp JOIN remote_photo_detail d ON d.photo_id = rp.id
        WHERE rp.image_hash = ${imageHash} LIMIT 1`
  );
  if (!row) return null;
  try {
    const parsed = parseJson(row.payload);
    if (!isRecord(parsed)) return null;
    const captions = isRecord(parsed.captions_json) ? parsed.captions_json : {};
    const patched = { ...parsed, captions_json: { ...captions, user_caption: caption } };
    return { photoId: row.photo_id, payload: JSON.stringify(patched) };
  } catch {
    return null;
  }
}

export async function captionPhoto(
  db: AppDatabase,
  args: { imageHash: string; caption: string },
  now = Date.now()
): Promise<MutationResult> {
  const patch = await patchedDetail(db, args.imageHash, args.caption);
  const outboxId = await mutate(
    db,
    patch ? [sql`UPDATE remote_photo_detail SET payload = ${patch.payload} WHERE photo_id = ${patch.photoId}`] : [],
    enqueueOutboxSql("caption", { imageHash: args.imageHash, caption: args.caption }, now)
  );
  return { outboxId };
}

/* ---- album membership + person mutations ------------------------------- */

function recountAlbumSql(albumId: number): SQL {
  return sql`UPDATE user_album
             SET photo_count = (SELECT COUNT(*) FROM user_album_photo WHERE album_id = ${albumId})
             WHERE id = ${albumId}`;
}

export async function addPhotosToAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string; photoIds: string[]; imageHashes: string[] },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [
      ...args.photoIds.map(
        (photoId, i) =>
          sql`INSERT INTO user_album_photo (album_id, photo_id, ordering)
              VALUES (${args.albumId}, ${photoId}, ${now + i})
              ON CONFLICT(album_id, photo_id) DO NOTHING`
      ),
      recountAlbumSql(args.albumId),
    ],
    enqueueOutboxSql("album_add", args, now)
  );
  return { outboxId };
}

export async function removePhotosFromAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string; photoIds: string[]; imageHashes: string[] },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [
      sql`DELETE FROM user_album_photo
          WHERE album_id = ${args.albumId} AND photo_id IN (${inList(args.photoIds)})`,
      recountAlbumSql(args.albumId),
    ],
    enqueueOutboxSql("album_remove", args, now)
  );
  return { outboxId };
}

/**
 * Allocate the next client-temp album id: a negative integer strictly below any
 * existing id (so it never collides with a positive server id nor a prior temp).
 */
export async function nextTempAlbumId(db: AppDatabase): Promise<number> {
  const row = await db.get<{ min: number | null }>(sql`SELECT MIN(id) AS min FROM user_album`);
  const floor = Math.min(0, row.min ?? 0);
  return floor - 1;
}

export type CreateAlbumResult = MutationResult & { tempId: number };

export async function createAlbum(
  db: AppDatabase,
  args: { title: string; photoIds: string[]; ownerId?: number | null },
  now = Date.now()
): Promise<CreateAlbumResult> {
  for (let attempt = 0; ; attempt += 1) {
    const tempId = await nextTempAlbumId(db);
    try {
      const outboxId = await mutate(
        db,
        [
          sql`INSERT INTO user_album (id, title, owner_id, shared, favorited, cover_hash, photo_count, created_on, last_modified)
              VALUES (${tempId}, ${args.title}, ${args.ownerId ?? null}, 0, 0, NULL, ${args.photoIds.length}, ${now}, ${now})`,
          ...args.photoIds.map(
            (photoId, i) =>
              sql`INSERT INTO user_album_photo (album_id, photo_id, ordering) VALUES (${tempId}, ${photoId}, ${i})`
          ),
        ],
        enqueueOutboxSql("album_create", { tempId, title: args.title, photoIds: args.photoIds }, now)
      );
      return { outboxId, tempId };
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

export async function renameAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [sql`UPDATE user_album SET title = ${args.title} WHERE id = ${args.albumId}`],
    enqueueOutboxSql("album_rename", args, now)
  );
  return { outboxId };
}

/**
 * Delete a user album: the album row and its membership leave the mirror at
 * once (the photos stay), and the delete is queued. A still-temp album's id is
 * rewritten to the server id when its create replays (reconcileTempAlbum).
 */
export async function deleteAlbum(
  db: AppDatabase,
  args: { albumId: number },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [
      sql`DELETE FROM user_album_photo WHERE album_id = ${args.albumId}`,
      sql`DELETE FROM user_album WHERE id = ${args.albumId}`,
    ],
    enqueueOutboxSql("album_delete", { albumId: args.albumId }, now)
  );
  return { outboxId };
}

/**
 * Set a user album's cover to one of its photos, or (photo null) go back to the
 * automatic cover, which the album lists derive from the newest photo.
 */
export async function setAlbumCover(
  db: AppDatabase,
  args: { albumId: number; photoId: string | null; imageHash: string | null },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [sql`UPDATE user_album SET cover_hash = ${args.imageHash} WHERE id = ${args.albumId}`],
    enqueueOutboxSql("album_cover", args, now)
  );
  return { outboxId };
}

export async function renamePerson(
  db: AppDatabase,
  args: { personId: number; name: string },
  now = Date.now()
): Promise<MutationResult> {
  const outboxId = await mutate(
    db,
    [sql`UPDATE person SET name = ${args.name} WHERE id = ${args.personId}`],
    enqueueOutboxSql("person_rename", args, now)
  );
  return { outboxId };
}
