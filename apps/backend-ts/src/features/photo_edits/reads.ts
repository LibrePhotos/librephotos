// Read queries of the photo_edits area (port of lp_db::photo_edits).
import { sql, type SQL } from "drizzle-orm";
import { db, row, type Db, type Tx } from "~/lib/db";
import { ownedBy, visibleManager } from "~/lib/scope";
import { drfTs, pyIsoTs } from "~/lib/time";

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** _get_photo_filter_kwargs: a 36-char, 4-hyphen UUID is a pk, anything else an image_hash. */
export function lookupUuid(lookup: string): string | undefined {
  if (lookup.length === 36 && lookup.split("-").length === 5 && UUID_RE.test(lookup)) return lookup.toLowerCase();
  return undefined;
}

/** The PhotoEditSerializer columns plus what the edit services need. */
export interface EditPhoto {
  id: string;
  image_hash: string;
  owner_id: number;
  hidden: boolean;
  rating: number;
  in_trashcan: boolean;
  removed: boolean;
  video: boolean;
  exif_timestamp: string | null;
  timestamp: string | null;
  /** micro-epoch text of the two timestamps (exact comparisons and dates). */
  exif_timestamp_us: string | null;
  timestamp_us: string | null;
  exif_day: string | null;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  is_screenshot: boolean;
  is_document: boolean;
  category_source: string;
  main_file_path: string | null;
}

const EDIT_COLUMNS = sql`p.id, p.image_hash, p.owner_id, p.hidden, p.rating, p.in_trashcan, p.removed, p.video,
  ${drfTs("p.exif_timestamp")} AS exif_timestamp, ${drfTs('p."timestamp"')} AS "timestamp",
  (extract(epoch FROM p.exif_timestamp) * 1000000)::bigint::text AS exif_timestamp_us,
  (extract(epoch FROM p."timestamp") * 1000000)::bigint::text AS timestamp_us,
  (p.exif_timestamp AT TIME ZONE 'UTC')::date::text AS exif_day,
  p.exif_gps_lat, p.exif_gps_lon, p.is_screenshot, p.is_document, p.category_source, mf.path AS main_file_path`;

/** PhotoEditViewSet.get_object: Photo.visible.owned_by(user) by pk or hash, .first() (= lowest pk). */
export function editTarget(userId: number, lookup: string) {
  const id = lookupUuid(lookup);
  const match: SQL = id ? sql`p.id = ${id}` : sql`p.image_hash = ${lookup}`;
  return row<EditPhoto>(sql`SELECT ${EDIT_COLUMNS} FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id
    WHERE ${ownedBy("p", userId)} AND ${visibleManager("p")} AND ${match} ORDER BY p.id LIMIT 1`);
}

export function editPhotoById(id: string, tx: Db | Tx = db) {
  return row<EditPhoto>(sql`SELECT ${EDIT_COLUMNS} FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id WHERE p.id = ${id}`, tx);
}

/** A photo of the requester's, as the caption/rotate/share views find it. */
export interface OwnedPhoto {
  id: string;
  image_hash: string;
  video: boolean;
  local_orientation: number;
  last_modified: string;
  thumbnail_big: string | null;
  has_thumbnail_row: boolean;
  main_file_path: string | null;
}

const OWNED = sql`SELECT p.id, p.image_hash, p.video, p.local_orientation, ${pyIsoTs("p.last_modified")} AS last_modified,
  t.thumbnail_big, (t.photo_id IS NOT NULL) AS has_thumbnail_row, mf.path AS main_file_path
  FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id LEFT JOIN api_file mf ON mf.hash = p.main_file_id`;

/** Photo.objects.owned_by(user).filter(image_hash=h).first() */
export function ownedByHash(userId: number, imageHash: string) {
  return row<OwnedPhoto>(sql`${OWNED} WHERE ${ownedBy("p", userId)} AND p.image_hash = ${imageHash} ORDER BY p.id LIMIT 1`);
}
