// Member photos of stacks and duplicate groups (previews and details), shared
// by both lists. Port of lp_db::stats_admin_stacks_dupes::stacks::members.
import { sql } from "drizzle-orm";
import { db, pgArray, rows, type Db, type Tx } from "~/lib/db";
import { drfTs } from "~/lib/time";
import { smallThumbnailUrl } from "./common";

export interface MemberPhoto {
  group_id: string;
  id: string;
  image_hash: string;
  size: number;
  exif_timestamp: string | null;
  thumb_small: string | null;
  thumb_big: string | null;
  width: number | null;
  height: number | null;
  camera: string | null;
  main_file_hash: string | null;
  main_file_path: string | null;
  main_file_type: number | null;
}

/**
 * Members of groups through a link table (api_photo_stacks /
 * api_photo_duplicates), in link order; at most perGroup per group.
 */
export function members(
  link: "api_photo_stacks" | "api_photo_duplicates",
  groupIds: string[],
  perGroup: number | null,
  tx: Db | Tx = db,
): Promise<MemberPhoto[]> {
  if (!groupIds.length) return Promise.resolve([]);
  const col = sql.raw(link === "api_photo_stacks" ? "photostack_id" : "duplicate_id");
  return rows<MemberPhoto>(
    sql`SELECT x.group_id, p.id, p.image_hash, p.size::float8 AS size, ${drfTs("p.exif_timestamp")} AS exif_timestamp,
        th.square_thumbnail_small AS thumb_small, th.thumbnail_big AS thumb_big,
        m.width, m.height, m.camera_model AS camera,
        mf.hash AS main_file_hash, mf.path AS main_file_path, mf.type AS main_file_type
      FROM (SELECT l.${col} AS group_id, l.photo_id, row_number() OVER (PARTITION BY l.${col} ORDER BY l.id) AS rn
            FROM ${sql.raw(link)} l WHERE l.${col} = ANY(${pgArray(groupIds, "uuid")})) x
      JOIN api_photo p ON p.id = x.photo_id
      LEFT JOIN api_thumbnail th ON th.photo_id = p.id
      LEFT JOIN api_photometadata m ON m.photo_id = p.id
      LEFT JOIN api_file mf ON mf.hash = p.main_file_id
      WHERE ${perGroup}::bigint IS NULL OR x.rn <= ${perGroup}::bigint ORDER BY x.group_id, x.rn`,
    tx,
  );
}

/** Group members by group id, keeping their order. */
export function byGroup(ms: MemberPhoto[]): Map<string, MemberPhoto[]> {
  const out = new Map<string, MemberPhoto[]>();
  for (const m of ms) {
    const list = out.get(m.group_id);
    if (list) list.push(m);
    else out.set(m.group_id, [m]);
  }
  return out;
}

export const photoRef = (m: Pick<MemberPhoto, "image_hash" | "thumb_small">) => ({
  image_hash: m.image_hash,
  thumbnail_url: smallThumbnailUrl(m.image_hash, m.thumb_small),
});

/** `(owned, not hidden, not in the trash)` photo count as a scalar subquery. */
export const totalPhotos = (ownerSql: ReturnType<typeof sql>) =>
  sql`(SELECT count(*)::int FROM api_photo p WHERE NOT p.hidden AND NOT p.in_trashcan AND ${ownerSql})`;
