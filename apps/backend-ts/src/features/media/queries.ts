// Reads for media serving (port of lp_db::media): the photo a media URL
// names, with every grant api/views/media.py checks, in one query per request.
import { sql, type SQL } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { hasThumbnail, photoGrantsSelect, type PhotoGrants } from "~/lib/scope";

/** A photo as the media views need it, plus the requester's grants on it. */
export interface MediaPhoto extends PhotoGrants {
  id: string;
  owner_id: number;
  image_hash: string;
  video: boolean;
  video_length: string | null;
  /** photo.main_file.path (absolute, as the scanner stored it). */
  main_file_path: string | null;
  /** Thumbnail FileField names relative to MEDIA_ROOT; null without a thumbnail row. */
  thumbnail_big: string | null;
  square_thumbnail: string | null;
  square_thumbnail_small: string | null;
  /** The owner's scan directory: one of the roots originals may be served from. */
  owner_scan_directory: string;
}

const COLUMNS = sql.raw(`p.id::text AS id, p.owner_id, p.image_hash, p.video, p.video_length,
  f.path AS main_file_path, th.thumbnail_big, th.square_thumbnail, th.square_thumbnail_small,
  u.scan_directory AS owner_scan_directory`);

const FROM = sql.raw(`FROM api_photo p
  JOIN api_user u ON u.id = p.owner_id
  LEFT JOIN api_file f ON f.hash = p.main_file_id
  LEFT JOIN api_thumbnail th ON th.photo_id = p.id`);

const withGrants = (userId: number | null, where: SQL) =>
  sql`SELECT ${COLUMNS}, ${photoGrantsSelect("p", userId)} ${FROM} WHERE ${where}`;

/**
 * Every photo carrying image_hash (two users scanning the same file can
 * share one), each with the requester's grants. Unordered, like Django's
 * Photo.objects.filter(image_hash=...).
 */
export const photosByHash = (imageHash: string, userId: number | null) =>
  rows<MediaPhoto>(withGrants(userId, sql`p.image_hash = ${imageHash}`));

/** The photo with primary key id (a canonical UUID string), with the requester's grants. */
export const photoById = (id: string, userId: number | null) =>
  row<MediaPhoto>(withGrants(userId, sql`p.id = ${id}::uuid`));

/** How embedded_media and diagnostics address their photo. */
export type PhotoKey = { id: string } | { hash: string };
const keyWhere = (key: PhotoKey) => ("id" in key ? sql`p.id = ${key.id}::uuid` : sql`p.image_hash = ${key.hash}`);

/**
 * Path of the first embedded file (by File pk) of the first photo (by pk)
 * matching key among the owner's photos, or among public photos for an
 * anonymous requester. undefined = no photo; null = it embeds nothing.
 *
 * "Public" is Photo.visible.visible_to(None), as for every other media
 * kind; Django's bare public=True kept serving the motion video of a public
 * photo after it was hidden, trashed or removed.
 */
export async function embeddedMediaPath(key: PhotoKey, userId: number | null): Promise<string | null | undefined> {
  const scope =
    userId === null
      ? sql`(p.public AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND ${hasThumbnail("p")})`
      : sql`p.owner_id = ${userId}`;
  const r = await row<{ path: string | null }>(sql`SELECT (SELECT ef.path FROM api_file_embedded_media em
      JOIN api_file ef ON ef.hash = em.to_file_id
      WHERE em.from_file_id = p.main_file_id ORDER BY ef.hash LIMIT 1) AS path
    FROM api_photo p WHERE ${keyWhere(key)} AND ${scope} ORDER BY p.id LIMIT 1`);
  return r === undefined ? undefined : r.path;
}

/**
 * The photo behind an enabled photo share slug (active_photo_share): none
 * once the photo is hidden, trashed or removed. No grants apply; the slug
 * is the grant.
 */
export const photoForShare = (slug: string) =>
  row<MediaPhoto>(sql`SELECT ${COLUMNS}, FALSE AS is_owner, FALSE AS shared_directly,
      FALSE AS album_shared_to_user, FALSE AS in_public_album, FALSE AS is_public_photo
    FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id
      JOIN api_user u ON u.id = p.owner_id
      LEFT JOIN api_file f ON f.hash = p.main_file_id
      LEFT JOIN api_thumbnail th ON th.photo_id = p.id
    WHERE s.enabled AND s.slug = ${slug}
      AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed
    ORDER BY s.id LIMIT 1`);

/**
 * main_file.path of the first photo (by pk) matching key, for the admin
 * diagnostics view. undefined = no photo; null = its file was detached.
 */
export async function mainFilePath(key: PhotoKey): Promise<string | null | undefined> {
  const r = await row<{ path: string | null }>(
    sql`SELECT f.path FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE ${keyWhere(key)} ORDER BY p.id LIMIT 1`,
  );
  return r === undefined ? undefined : r.path;
}
