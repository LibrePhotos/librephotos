// PhotoSummarySerializer, the "PigPhoto" every grid renders (port of
// lp_db::pig). One query shape for every list:
//
//   const photos = await pigFetch(sql`WHERE ${ownedBy("p", user.id)} ORDER BY p.exif_timestamp DESC`);
//   const photos = await pigByIds(ids);           // keeps the order of ids
//
// The WHERE/ORDER part is written against alias `p` (api_photo).
import { sql, type SQL } from "drizzle-orm";
import { db, pgArray, rows, type Db, type Tx } from "./db";
import { drfTs, pyIsoTs } from "./time";

export const VALID_STACK_TYPES_SQL = "('burst', 'bracket', 'manual')";

const PIG_TAIL = sql.raw(`p.rating, p.video,
  p.video_length, p.exif_gps_lat, p.exif_gps_lon, p.removed, p.in_trashcan, p.local_orientation,
  pig_t.aspect_ratio, pig_t.dominant_color, pig_s.search_location,
  pig_u.id AS owner_id, pig_u.username AS owner_username,
  pig_u.first_name AS owner_first_name, pig_u.last_name AS owner_last_name,
  (p.main_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM api_file_embedded_media pig_em
      WHERE pig_em.from_file_id = p.main_file_id)) AS has_embedded_media,
  EXISTS (SELECT 1 FROM api_photo_files pig_pf JOIN api_file pig_f ON pig_f.hash = pig_pf.file_id
      WHERE pig_pf.photo_id = p.id AND pig_f.type = 4) AS has_raw_variant,
  (SELECT jsonb_agg(jsonb_build_object('id', pig_st.id, 'type', pig_st.stack_type,
          'photo_count', (SELECT count(*) FROM api_photo_stacks pig_c WHERE pig_c.photostack_id = pig_st.id),
          'is_primary', COALESCE(pig_st.primary_photo_id = p.id, FALSE))
      ORDER BY pig_st.created_at DESC, pig_st.id)
    FROM api_photo_stacks pig_ps JOIN api_photostack pig_st ON pig_st.id = pig_ps.photostack_id
    WHERE pig_ps.photo_id = p.id AND pig_st.stack_type IN ${VALID_STACK_TYPES_SQL}) AS stacks`);

const TS_COLUMNS = sql`${pyIsoTs("p.exif_timestamp")} AS date_iso, ${drfTs("p.exif_timestamp")} AS date_drf,
  extract(epoch FROM p.exif_timestamp) AS ts_epoch, (p.exif_timestamp AT TIME ZONE 'UTC')::date::text AS ts_day`;

/** The PigPhoto select list (alias p) - for custom queries that add columns. */
export const pigColumns = (): SQL => sql`p.id, p.image_hash, ${TS_COLUMNS}, ${PIG_TAIL}`;

export const PIG_JOINS = sql.raw(` LEFT JOIN api_thumbnail pig_t ON pig_t.photo_id = p.id
  LEFT JOIN api_photo_search pig_s ON pig_s.photo_id = p.id
  JOIN api_user pig_u ON pig_u.id = p.owner_id`);

export interface StackSummary {
  id: string;
  type: string;
  photo_count: number;
  is_primary: boolean;
}

export interface PigRow {
  id: string;
  image_hash: string;
  date_iso: string | null;
  date_drf: string | null;
  ts_epoch: string | number | null;
  ts_day: string | null;
  rating: number;
  video: boolean;
  video_length: string | null;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  removed: boolean;
  in_trashcan: boolean;
  local_orientation: number;
  aspect_ratio: number | null;
  dominant_color: string | null;
  search_location: string | null;
  owner_id: number;
  owner_username: string;
  owner_first_name: string;
  owner_last_name: string;
  has_embedded_media: boolean;
  has_raw_variant: boolean;
  stacks: StackSummary[] | null;
}

export interface PigPhoto {
  id: string;
  image_hash: string;
  dominantColor: string;
  url: string;
  location: string;
  date: string;
  birthTime: string;
  aspectRatio: number | null;
  type: "video" | "motion_photo" | "image";
  video_length: string;
  rating: number;
  owner: { id: number; username: string; first_name: string; last_name: string };
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  removed: boolean;
  in_trashcan: boolean;
  stacks: StackSummary[] | null;
  has_raw_variant: boolean;
  local_orientation: number;
}

/** Thumbnail.dominant_color "[r, g, b]" -> "#rrggbb" ("" when absent/unparsable). */
export function cssHex(text: string | null | undefined): string {
  if (!text) return "";
  const m = /^\[(-?\d+), (-?\d+), (-?\d+)\]$/.exec(text);
  if (!m) return "";
  const parts = m.slice(1, 4).map(Number);
  if (parts.some((n) => n < 0 || n > 255)) return "";
  return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function pigFromRow(r: PigRow): PigPhoto {
  const stacks = r.stacks && r.stacks.length ? r.stacks.map((s) => ({ ...s, photo_count: Number(s.photo_count) })) : null;
  return {
    id: r.id,
    image_hash: r.image_hash,
    dominantColor: cssHex(r.dominant_color),
    url: r.image_hash,
    location: r.search_location || "",
    date: r.date_iso ?? "",
    birthTime: r.date_drf ?? "",
    aspectRatio: r.aspect_ratio,
    type: r.video ? "video" : r.has_embedded_media ? "motion_photo" : "image",
    video_length: r.video_length || "",
    rating: r.rating,
    owner: { id: r.owner_id, username: r.owner_username, first_name: r.owner_first_name, last_name: r.owner_last_name },
    exif_gps_lat: r.exif_gps_lat,
    exif_gps_lon: r.exif_gps_lon,
    removed: r.removed,
    in_trashcan: r.in_trashcan,
    stacks,
    has_raw_variant: r.has_raw_variant,
    local_orientation: r.local_orientation,
  };
}

/** Raw PigPhoto rows: `SELECT <pig columns> FROM api_photo p <joins> <rest>`. */
export function pigRows(rest: SQL, tx: Db | Tx = db): Promise<PigRow[]> {
  return rows<PigRow>(sql`SELECT ${pigColumns()} FROM api_photo p${PIG_JOINS} ${rest}`, tx);
}

export async function pigFetch(rest: SQL, tx: Db | Tx = db): Promise<PigPhoto[]> {
  return (await pigRows(rest, tx)).map(pigFromRow);
}

/** PigPhotos for ids, in the order given. */
export async function pigByIds(ids: string[], tx: Db | Tx = db): Promise<PigPhoto[]> {
  if (!ids.length) return [];
  const rs = await rows<PigRow>(
    sql`SELECT ${pigColumns()} FROM unnest(${pgArray(ids, "uuid")}) WITH ORDINALITY AS pig_sel(id, ord)
        JOIN api_photo p ON p.id = pig_sel.id${PIG_JOINS} ORDER BY pig_sel.ord`,
    tx,
  );
  return rs.map(pigFromRow);
}

export interface DateGroup {
  date: string;
  location: string;
  items: PigPhoto[];
}

/**
 * Consecutive same-UTC-day runs become one group (dated by the first photo,
 * DRF format); photos without a timestamp go to a final "No timestamp" group.
 * Takes rows (it needs the day), returns serialized groups.
 */
export function groupByDate(rs: PigRow[]): DateGroup[] {
  const out: DateGroup[] = [];
  const noTs: PigPhoto[] = [];
  let current: string | null = null;
  for (const r of rs) {
    const photo = pigFromRow(r);
    if (r.ts_day === null) {
      current = null;
      noTs.push(photo);
    } else if (current === r.ts_day) {
      out[out.length - 1].items.push(photo);
    } else {
      current = r.ts_day;
      out.push({ date: r.date_drf!, location: "", items: [photo] });
    }
  }
  if (noTs.length) out.push({ date: "No timestamp", location: "", items: noTs });
  return out;
}
