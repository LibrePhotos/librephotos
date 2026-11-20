/**
 * Map a timeline "pig" photo (the seed's list endpoints) onto a mirror row for
 * @librephotos/local-db's writers. The package does not know the API client;
 * mapping the wire onto its inputs is the app's job (see ./mappers for the
 * delta feed).
 */
import { imageHashOf, type PigPhoto } from "@librephotos/api-client";
import { bucketDayFromMs, bucketMonthFromMs, parseServerTimestamp, type RemotePhotoInput } from "@librephotos/local-db";

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
    archived: pig.archived ?? false,
    // The timeline list does not carry the media categories; the delta feed does.
    isScreenshot: false,
    isDocument: false,
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
