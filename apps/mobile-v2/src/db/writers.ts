/**
 * Mirror writers: map api-client rows onto mirror rows and upsert them in
 * bounded transactions. Upserts are idempotent (ON CONFLICT DO UPDATE keyed on
 * the server id) so a re-seed / pull-to-refresh converges without duplicates.
 *
 * Batching: each chunk of ≤1000 rows commits in its own transaction so the UI
 * thread stays responsive and live queries re-fire per commit, not per row
 * (doc 02 §5).
 */
import { sql } from "drizzle-orm";
import type { PigPhoto } from "@librephotos/api-client";
import { imageHashOf } from "@librephotos/api-client";
import type { AppDatabase } from "./types";
import { bucketDayFromMs, bucketMonthFromMs, parseServerTimestamp } from "./time";

export const BATCH_SIZE = 1000;

export type RemotePhotoInput = {
  id: string;
  imageHash: string;
  ownerId: number;
  timestamp: number | null;
  addedOn: number;
  lastModified: number;
  type: string;
  videoLengthMs: number | null;
  rating: number;
  isFavorite: boolean;
  hidden: boolean;
  inTrashcan: boolean;
  removed: boolean;
  isPublic: boolean;
  aspectRatio: number | null;
  latitude: number | null;
  longitude: number | null;
  searchLocation: string | null;
  dominantColor: string | null;
  bucketDay: string;
  bucketMonth: string;
};

/** Parse a "H:MM:SS" / "MM:SS" video length string to milliseconds. */
export function videoLengthToMs(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return secs * 1000;
}

export type MapOptions = {
  ownerId: number;
  favoriteMinRating: number;
  now: number;
  /** Photoset context flags — the source list already scopes these. */
  hidden?: boolean;
  inTrashcan?: boolean;
  isPublic?: boolean;
};

/**
 * Map a timeline "pig" photo onto a mirror row. `is_favorite` is materialized
 * here from rating >= favorite_min_rating (doc 02 §1); buckets are precomputed.
 */
export function pigPhotoToRemoteRow(pig: PigPhoto, opts: MapOptions): RemotePhotoInput {
  const timestamp = parseServerTimestamp(pig.date);
  const addedOn = parseServerTimestamp(pig.birthTime) ?? timestamp ?? opts.now;
  const bucketBasis = timestamp ?? addedOn;
  return {
    id: pig.id,
    imageHash: imageHashOf(pig),
    ownerId: pig.owner?.id ?? opts.ownerId,
    timestamp,
    addedOn,
    lastModified: opts.now,
    type: pig.type,
    videoLengthMs: videoLengthToMs(pig.video_length),
    rating: pig.rating,
    isFavorite: pig.rating >= opts.favoriteMinRating,
    hidden: opts.hidden ?? false,
    inTrashcan: pig.in_trashcan ?? opts.inTrashcan ?? false,
    removed: pig.removed ?? false,
    isPublic: opts.isPublic ?? false,
    aspectRatio: pig.aspectRatio,
    latitude: pig.exif_gps_lat ?? null,
    longitude: pig.exif_gps_lon ?? null,
    searchLocation: pig.location ?? null,
    dominantColor: pig.dominantColor ?? null,
    bucketDay: bucketDayFromMs(bucketBasis),
    bucketMonth: bucketMonthFromMs(bucketBasis),
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const b = (v: boolean) => (v ? 1 : 0);

/** Idempotent batched upsert of remote photos. Returns rows written. */
export function upsertRemotePhotos(db: AppDatabase, rows: RemotePhotoInput[]): number {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO remote_photo
            (id, image_hash, owner_id, timestamp, added_on, last_modified, type, video_length_ms,
             rating, is_favorite, hidden, in_trashcan, removed, is_public, aspect_ratio,
             latitude, longitude, search_location, dominant_color, bucket_day, bucket_month)
            VALUES (${r.id}, ${r.imageHash}, ${r.ownerId}, ${r.timestamp}, ${r.addedOn}, ${r.lastModified},
             ${r.type}, ${r.videoLengthMs}, ${r.rating}, ${b(r.isFavorite)}, ${b(r.hidden)}, ${b(r.inTrashcan)},
             ${b(r.removed)}, ${b(r.isPublic)}, ${r.aspectRatio}, ${r.latitude}, ${r.longitude},
             ${r.searchLocation}, ${r.dominantColor}, ${r.bucketDay}, ${r.bucketMonth})
            ON CONFLICT(id) DO UPDATE SET
              image_hash = excluded.image_hash, owner_id = excluded.owner_id, timestamp = excluded.timestamp,
              added_on = excluded.added_on, last_modified = excluded.last_modified, type = excluded.type,
              video_length_ms = excluded.video_length_ms, rating = excluded.rating,
              is_favorite = excluded.is_favorite, hidden = excluded.hidden, in_trashcan = excluded.in_trashcan,
              removed = excluded.removed, is_public = excluded.is_public, aspect_ratio = excluded.aspect_ratio,
              latitude = excluded.latitude, longitude = excluded.longitude,
              search_location = excluded.search_location, dominant_color = excluded.dominant_color,
              bucket_day = excluded.bucket_day, bucket_month = excluded.bucket_month`
        );
      }
    });
  }
  return rows.length;
}

export type PersonInput = {
  id: number;
  name: string | null;
  kind: string | null;
  faceCount: number | null;
  coverPhotoHash: string | null;
  lastModified: number | null;
};

export function upsertPersons(db: AppDatabase, rows: PersonInput[]): number {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO person (id, name, kind, face_count, cover_photo_hash, last_modified)
              VALUES (${r.id}, ${r.name}, ${r.kind}, ${r.faceCount}, ${r.coverPhotoHash}, ${r.lastModified})
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, kind = excluded.kind, face_count = excluded.face_count,
                cover_photo_hash = excluded.cover_photo_hash, last_modified = excluded.last_modified`
        );
      }
    });
  }
  return rows.length;
}

export type UserAlbumInput = {
  id: number;
  title: string;
  ownerId: number | null;
  shared: boolean;
  favorited: boolean;
  coverHash: string | null;
  photoCount: number;
  createdOn: number | null;
  lastModified: number | null;
  /** Ordered photo ids for membership (replaces existing membership). */
  photoIds?: string[];
};

export function upsertUserAlbums(db: AppDatabase, rows: UserAlbumInput[]): number {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO user_album
              (id, title, owner_id, shared, favorited, cover_hash, photo_count, created_on, last_modified)
              VALUES (${r.id}, ${r.title}, ${r.ownerId}, ${b(r.shared)}, ${b(r.favorited)}, ${r.coverHash},
                ${r.photoCount}, ${r.createdOn}, ${r.lastModified})
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, owner_id = excluded.owner_id, shared = excluded.shared,
                favorited = excluded.favorited, cover_hash = excluded.cover_hash,
                photo_count = excluded.photo_count, created_on = excluded.created_on,
                last_modified = excluded.last_modified`
        );
        if (r.photoIds) replaceUserAlbumMembership(tx, r.id, r.photoIds);
      }
    });
  }
  return rows.length;
}

function replaceUserAlbumMembership(db: AppDatabase, albumId: number, photoIds: string[]): void {
  db.run(sql`DELETE FROM user_album_photo WHERE album_id = ${albumId}`);
  photoIds.forEach((photoId, ordering) => {
    db.run(
      sql`INSERT INTO user_album_photo (album_id, photo_id, ordering) VALUES (${albumId}, ${photoId}, ${ordering})
          ON CONFLICT(album_id, photo_id) DO UPDATE SET ordering = excluded.ordering`
    );
  });
}

export type AutoAlbumInput = {
  id: number;
  title: string;
  timestamp: number | null;
  favorited: boolean;
  photoCount: number;
  coverHash: string | null;
  lastModified: number | null;
  photoIds?: string[];
};

export function upsertAutoAlbums(db: AppDatabase, rows: AutoAlbumInput[]): number {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO auto_album (id, title, timestamp, favorited, photo_count, cover_hash, last_modified)
              VALUES (${r.id}, ${r.title}, ${r.timestamp}, ${b(r.favorited)}, ${r.photoCount}, ${r.coverHash}, ${r.lastModified})
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, timestamp = excluded.timestamp, favorited = excluded.favorited,
                photo_count = excluded.photo_count, cover_hash = excluded.cover_hash,
                last_modified = excluded.last_modified`
        );
        if (r.photoIds) {
          db.run(sql`DELETE FROM auto_album_photo WHERE album_id = ${r.id}`);
          r.photoIds.forEach((photoId, ordering) => {
            db.run(
              sql`INSERT INTO auto_album_photo (album_id, photo_id, ordering) VALUES (${r.id}, ${photoId}, ${ordering})
                  ON CONFLICT(album_id, photo_id) DO UPDATE SET ordering = excluded.ordering`
            );
          });
        }
      }
    });
  }
  return rows.length;
}

export type NamedAlbumInput = {
  id: number;
  title: string;
  photoCount: number;
  coverHashes: string[] | null;
  lastModified: number | null;
  geolocationLevel?: number | null;
};

export function upsertThingAlbums(db: AppDatabase, rows: NamedAlbumInput[]): number {
  return upsertNamedAlbums(db, "thing_album", rows);
}

export function upsertTagAlbums(db: AppDatabase, rows: NamedAlbumInput[]): number {
  return upsertNamedAlbums(db, "tag_album", rows);
}

function upsertNamedAlbums(
  db: AppDatabase,
  table: "thing_album" | "tag_album",
  rows: NamedAlbumInput[]
): number {
  const tbl = sql.raw(table);
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO ${tbl} (id, title, photo_count, cover_hashes, last_modified)
              VALUES (${r.id}, ${r.title}, ${r.photoCount}, ${r.coverHashes ? JSON.stringify(r.coverHashes) : null}, ${r.lastModified})
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, photo_count = excluded.photo_count,
                cover_hashes = excluded.cover_hashes, last_modified = excluded.last_modified`
        );
      }
    });
  }
  return rows.length;
}

export function upsertPlaceAlbums(db: AppDatabase, rows: NamedAlbumInput[]): number {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.transaction((tx) => {
      for (const r of batch) {
        tx.run(
          sql`INSERT INTO place_album (id, title, photo_count, geolocation_level, cover_hashes, last_modified)
              VALUES (${r.id}, ${r.title}, ${r.photoCount}, ${r.geolocationLevel ?? null},
                ${r.coverHashes ? JSON.stringify(r.coverHashes) : null}, ${r.lastModified})
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, photo_count = excluded.photo_count,
                geolocation_level = excluded.geolocation_level, cover_hashes = excluded.cover_hashes,
                last_modified = excluded.last_modified`
        );
      }
    });
  }
  return rows.length;
}
