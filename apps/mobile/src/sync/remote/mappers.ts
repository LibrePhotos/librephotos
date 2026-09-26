/**
 * Map delta-sync wire items onto mirror writer inputs (doc 02 §1). Unlike the
 * Phase 1 seed mappers, `last_modified` comes straight from the server item (the
 * keyset ordering key), NOT a seed-time placeholder — this is what makes delta
 * pulls resumable and idempotent. `is_favorite` is likewise materialized
 * server-side (resolved against the owner's favorite_min_rating), so the client
 * stores the boolean verbatim.
 */
import type {
  SyncAutoAlbumItem,
  SyncNamedAlbumItem,
  SyncPersonItem,
  SyncPhotoItem,
  SyncPlaceAlbumItem,
  SyncSharedUserItem,
  SyncUserAlbumItem,
} from "@librephotos/api-client";
import { bucketDayFromMs, bucketMonthFromMs } from "@/db/time";
import type {
  AutoAlbumInput,
  NamedAlbumInput,
  PersonInput,
  RemotePhotoInput,
  SharedUserInput,
  UserAlbumInput,
} from "@/db/writers";

export function syncPhotoToRow(item: SyncPhotoItem, now: number): RemotePhotoInput {
  const timestamp = item.timestamp ?? null;
  const addedOn = item.added_on ?? timestamp ?? now;
  const bucketBasis = timestamp ?? addedOn;
  return {
    id: item.id,
    imageHash: item.image_hash,
    ownerId: item.owner_id,
    timestamp,
    addedOn,
    lastModified: item.last_modified ?? now,
    type: item.type,
    videoLengthMs: item.video_length_ms ?? null,
    rating: item.rating,
    isFavorite: item.is_favorite,
    hidden: item.hidden,
    inTrashcan: item.in_trashcan,
    removed: item.removed,
    isPublic: item.is_public,
    aspectRatio: item.aspect_ratio ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    searchLocation: item.search_location || null,
    dominantColor: item.dominant_color ?? null,
    bucketDay: bucketDayFromMs(bucketBasis),
    bucketMonth: bucketMonthFromMs(bucketBasis),
  };
}

export function syncPersonToRow(item: SyncPersonItem): PersonInput {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    faceCount: item.face_count,
    coverPhotoHash: item.cover_photo_hash,
    lastModified: item.last_modified,
  };
}

export function syncUserAlbumToRow(item: SyncUserAlbumItem): UserAlbumInput {
  return {
    id: item.id,
    title: item.title,
    ownerId: item.owner_id,
    shared: item.shared !== 0,
    favorited: item.favorited,
    coverHash: item.cover_hash,
    photoCount: item.photo_count,
    createdOn: item.created_on,
    lastModified: item.last_modified,
    photoIds: item.photo_ids,
  };
}

export function syncAutoAlbumToRow(item: SyncAutoAlbumItem): AutoAlbumInput {
  return {
    id: item.id,
    title: item.title,
    timestamp: item.timestamp,
    favorited: item.favorited,
    photoCount: item.photo_count,
    coverHash: item.cover_hash,
    lastModified: item.last_modified,
    photoIds: item.photo_ids,
  };
}

export function syncNamedAlbumToRow(item: SyncNamedAlbumItem): NamedAlbumInput {
  return {
    id: item.id,
    title: item.title,
    photoCount: item.photo_count,
    coverHashes: item.cover_hashes,
    lastModified: item.last_modified,
  };
}

export function syncPlaceAlbumToRow(item: SyncPlaceAlbumItem): NamedAlbumInput {
  return {
    id: item.id,
    title: item.title,
    photoCount: item.photo_count,
    coverHashes: item.cover_hashes,
    geolocationLevel: item.geolocation_level,
    lastModified: item.last_modified,
  };
}

export function syncSharedUserToRow(item: SyncSharedUserItem): SharedUserInput {
  return {
    id: item.id,
    username: item.username,
    firstName: item.first_name,
    lastName: item.last_name,
    avatarUrl: item.avatar_url,
  };
}
