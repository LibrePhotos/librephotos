import { imageHashOf, type PigPhoto } from "@librephotos/api-client";
import { bucketDayFromMs, bucketMonthFromMs, parseServerTimestamp, type RemotePhotoInput } from "@librephotos/local-db";

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
  hidden?: boolean;
  inTrashcan?: boolean;
  isPublic?: boolean;
};

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
