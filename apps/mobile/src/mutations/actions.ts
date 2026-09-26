/**
 * Offline mutation actions (doc 03 §6). Each function performs, in ONE
 * transaction: (a) the optimistic write to the mirror tables and (b) a
 * zod-validated `outbox` row insert. If either throws, the transaction rolls
 * back both — the UI never shows a write that wasn't queued, and vice versa.
 * Live queries re-fire on commit, so the UI updates instantly.
 *
 * Pure SQL + drizzle only (no expo / no network) so the whole module is
 * Node-tested. The app-facing hook (./useMutations) wraps these with a
 * `notifyOutboxWrite()` trigger so replay runs before the next delta pull.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import { getMetaNumber, META_FAVORITE_MIN_RATING } from "@/db/queries/app-meta";
import { enqueueOutbox } from "./outbox";

/** LibrePhotos default when the server threshold hasn't been synced yet. */
export const DEFAULT_FAVORITE_MIN_RATING = 4;

export type MutationResult = { outboxId: number };

function favoriteMinRating(db: AppDatabase): number {
  return getMetaNumber(db, META_FAVORITE_MIN_RATING) ?? DEFAULT_FAVORITE_MIN_RATING;
}

function inList(values: string[]): ReturnType<typeof sql> {
  // Build a safe parameterized `(?, ?, …)` list.
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

/* ---- photo flag mutations ---------------------------------------------- */

export function favoritePhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; favorite: boolean },
  now = Date.now()
): MutationResult {
  const threshold = favoriteMinRating(db);
  const rating = args.favorite ? threshold : 0;
  return db.transaction((tx) => {
    tx.run(
      sql`UPDATE remote_photo SET is_favorite = ${args.favorite ? 1 : 0}, rating = ${rating}
          WHERE image_hash IN (${inList(args.imageHashes)})`
    );
    const outboxId = enqueueOutbox(
      tx,
      "favorite",
      { imageHashes: args.imageHashes, favorite: args.favorite },
      now
    );
    return { outboxId };
  });
}

export function hidePhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; hidden: boolean },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    tx.run(
      sql`UPDATE remote_photo SET hidden = ${args.hidden ? 1 : 0}
          WHERE image_hash IN (${inList(args.imageHashes)})`
    );
    const outboxId = enqueueOutbox(
      tx,
      "hide",
      { imageHashes: args.imageHashes, hidden: args.hidden },
      now
    );
    return { outboxId };
  });
}

export function trashPhotos(
  db: AppDatabase,
  args: { imageHashes: string[]; deleted: boolean },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    tx.run(
      sql`UPDATE remote_photo SET in_trashcan = ${args.deleted ? 1 : 0}
          WHERE image_hash IN (${inList(args.imageHashes)})`
    );
    const outboxId = enqueueOutbox(
      tx,
      "trash",
      { imageHashes: args.imageHashes, deleted: args.deleted },
      now
    );
    return { outboxId };
  });
}

export function ratePhoto(
  db: AppDatabase,
  args: { imageHash: string; rating: number },
  now = Date.now()
): MutationResult {
  const threshold = favoriteMinRating(db);
  const isFavorite = args.rating >= threshold ? 1 : 0;
  return db.transaction((tx) => {
    tx.run(
      sql`UPDATE remote_photo SET rating = ${args.rating}, is_favorite = ${isFavorite}
          WHERE image_hash = ${args.imageHash}`
    );
    const outboxId = enqueueOutbox(tx, "rating", { imageHash: args.imageHash, rating: args.rating }, now);
    return { outboxId };
  });
}

export function captionPhoto(
  db: AppDatabase,
  args: { imageHash: string; caption: string },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    // Best-effort optimistic patch of the cached detail payload (may be absent
    // offline; the next detail fetch refreshes truth regardless).
    const photoId = (
      tx.get(sql`SELECT id FROM remote_photo WHERE image_hash = ${args.imageHash} LIMIT 1`) as
        | { id: string }
        | undefined
    )?.id;
    if (photoId) {
      const cached = tx.get(
        sql`SELECT payload FROM remote_photo_detail WHERE photo_id = ${photoId}`
      ) as { payload: string } | undefined;
      if (cached) {
        try {
          const parsed = JSON.parse(cached.payload) as Record<string, unknown>;
          const captions = (parsed.captions_json ?? {}) as Record<string, unknown>;
          parsed.captions_json = { ...captions, user_caption: args.caption };
          tx.run(
            sql`UPDATE remote_photo_detail SET payload = ${JSON.stringify(parsed)} WHERE photo_id = ${photoId}`
          );
        } catch {
          // Malformed cache — leave it; the outbox row is what matters.
        }
      }
    }
    const outboxId = enqueueOutbox(tx, "caption", { imageHash: args.imageHash, caption: args.caption }, now);
    return { outboxId };
  });
}

/* ---- album membership + person mutations ------------------------------- */

function recountAlbum(tx: AppDatabase, albumId: number): void {
  tx.run(
    sql`UPDATE user_album
        SET photo_count = (SELECT COUNT(*) FROM user_album_photo WHERE album_id = ${albumId})
        WHERE id = ${albumId}`
  );
}

export function addPhotosToAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string; photoIds: string[]; imageHashes: string[] },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    args.photoIds.forEach((photoId, i) => {
      tx.run(
        sql`INSERT INTO user_album_photo (album_id, photo_id, ordering)
            VALUES (${args.albumId}, ${photoId}, ${now + i})
            ON CONFLICT(album_id, photo_id) DO NOTHING`
      );
    });
    recountAlbum(tx, args.albumId);
    const outboxId = enqueueOutbox(tx, "album_add", args, now);
    return { outboxId };
  });
}

export function removePhotosFromAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string; photoIds: string[]; imageHashes: string[] },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    tx.run(
      sql`DELETE FROM user_album_photo
          WHERE album_id = ${args.albumId} AND photo_id IN (${inList(args.photoIds)})`
    );
    recountAlbum(tx, args.albumId);
    const outboxId = enqueueOutbox(tx, "album_remove", args, now);
    return { outboxId };
  });
}

/**
 * Allocate the next client-temp album id: a negative integer strictly below any
 * existing id (so it never collides with a positive server id nor a prior temp).
 */
export function nextTempAlbumId(db: AppDatabase): number {
  const row = db.get(sql`SELECT MIN(id) AS min FROM user_album`) as { min: number | null };
  const floor = Math.min(0, row.min ?? 0);
  return floor - 1;
}

export type CreateAlbumResult = MutationResult & { tempId: number };

export function createAlbum(
  db: AppDatabase,
  args: { title: string; photoIds: string[]; ownerId?: number | null },
  now = Date.now()
): CreateAlbumResult {
  return db.transaction((tx) => {
    const tempId = nextTempAlbumId(tx);
    tx.run(
      sql`INSERT INTO user_album (id, title, owner_id, shared, favorited, cover_hash, photo_count, created_on, last_modified)
          VALUES (${tempId}, ${args.title}, ${args.ownerId ?? null}, 0, 0, NULL, ${args.photoIds.length}, ${now}, ${now})`
    );
    args.photoIds.forEach((photoId, i) => {
      tx.run(
        sql`INSERT INTO user_album_photo (album_id, photo_id, ordering) VALUES (${tempId}, ${photoId}, ${i})`
      );
    });
    const outboxId = enqueueOutbox(tx, "album_create", { tempId, title: args.title, photoIds: args.photoIds }, now);
    return { outboxId, tempId };
  });
}

export function renameAlbum(
  db: AppDatabase,
  args: { albumId: number; title: string },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    tx.run(sql`UPDATE user_album SET title = ${args.title} WHERE id = ${args.albumId}`);
    const outboxId = enqueueOutbox(tx, "album_rename", args, now);
    return { outboxId };
  });
}

export function renamePerson(
  db: AppDatabase,
  args: { personId: number; name: string },
  now = Date.now()
): MutationResult {
  return db.transaction((tx) => {
    tx.run(sql`UPDATE person SET name = ${args.name} WHERE id = ${args.personId}`);
    const outboxId = enqueueOutbox(tx, "person_rename", args, now);
    return { outboxId };
  });
}
