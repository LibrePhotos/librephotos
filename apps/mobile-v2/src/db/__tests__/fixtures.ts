/**
 * Row builders for the Node DB tests. Remote rows go through the real writer
 * (so upsert/bucket/is_favorite logic is exercised); local rows are inserted
 * directly since the device-population path is Phase 3.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";
import { bucketDayFromMs, bucketMonthFromMs } from "../time";
import { upsertRemotePhotos, type RemotePhotoInput } from "../writers";

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export function remotePhoto(overrides: Partial<RemotePhotoInput> = {}): RemotePhotoInput {
  const id = overrides.id ?? uuid();
  const timestamp = overrides.timestamp === undefined ? Date.UTC(2024, 0, 1) : overrides.timestamp;
  const basis = timestamp ?? overrides.addedOn ?? Date.now();
  return {
    id,
    imageHash: overrides.imageHash ?? `hash-${id}`,
    ownerId: overrides.ownerId ?? 1,
    timestamp,
    addedOn: overrides.addedOn ?? basis,
    lastModified: overrides.lastModified ?? basis,
    type: overrides.type ?? "image",
    videoLengthMs: overrides.videoLengthMs ?? null,
    rating: overrides.rating ?? 0,
    isFavorite: overrides.isFavorite ?? false,
    hidden: overrides.hidden ?? false,
    inTrashcan: overrides.inTrashcan ?? false,
    removed: overrides.removed ?? false,
    isPublic: overrides.isPublic ?? false,
    aspectRatio: overrides.aspectRatio ?? 1,
    latitude: overrides.latitude ?? null,
    longitude: overrides.longitude ?? null,
    searchLocation: overrides.searchLocation ?? null,
    dominantColor: overrides.dominantColor ?? null,
    bucketDay: overrides.bucketDay ?? bucketDayFromMs(basis),
    bucketMonth: overrides.bucketMonth ?? bucketMonthFromMs(basis),
  };
}

export function seedRemotePhotos(db: AppDatabase, rows: RemotePhotoInput[]): void {
  upsertRemotePhotos(db, rows);
}

export function insertLocalAsset(
  db: AppDatabase,
  args: {
    id: string;
    hash?: string | null;
    createdAt?: number;
    type?: string;
    width?: number;
    height?: number;
    uri?: string;
    /** `'icloud'` for an asset the hash pass parked (bytes not on the device). */
    hashState?: string | null;
  }
): void {
  db.run(
    sql`INSERT INTO local_asset (id, name, type, created_at, modified_at, width, height, uri, hash, hashed_at, hash_state)
        VALUES (${args.id}, ${args.id}, ${args.type ?? "image"}, ${args.createdAt ?? Date.UTC(2024, 0, 1)},
                ${args.createdAt ?? Date.UTC(2024, 0, 1)}, ${args.width ?? 100}, ${args.height ?? 100},
                ${args.uri ?? `ph://${args.id}`}, ${args.hash ?? null}, ${args.hash ? Date.now() : null},
                ${args.hashState ?? null})`
  );
}

export function insertLocalAlbum(
  db: AppDatabase,
  args: { id: string; backupSelection: number; assetIds: string[] }
): void {
  db.run(
    sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
        VALUES (${args.id}, ${args.id}, ${args.assetIds.length}, ${Date.now()}, ${args.backupSelection})`
  );
  for (const assetId of args.assetIds) {
    db.run(
      sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES (${args.id}, ${assetId})`
    );
  }
}
