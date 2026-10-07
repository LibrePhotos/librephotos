// Mobile delta-sync feeds (/api/sync/*, Django api/views/sync.py and
// api/serializers/sync.py; port of lp_api::sync and lp_db::sync). Every feed
// answers the same envelope:
//
//   {"v": 1, "items": [...], "tombstones": ["id", ...],
//    "next_cursor": "<b64>" | null, "server_time": "<iso>", "total": n}
//
// total only on a request without a cursor; 400 {"error": "invalid_cursor"}
// for a cursor that does not decode, 410 {"error": "cursor_expired"} for one
// older than the tombstone horizon. A cursor whose id does not parse as the
// feed's primary key is a 500, as on Django (the ORM raises while filtering).
//
// Pages are keyset pages ordered by (last_modified, id). Per-page relations
// (album membership, covers, shared flags) are subqueries of the page query,
// so a feed is two statements: the page, and either the seed total or the
// tombstones since the cursor.
import { sql, type SQL } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import type { QueryMap } from "~/lib/query";
import { ownedOrShared } from "~/lib/scope";
import { pyIsoDate, pyIsoTs } from "~/lib/time";
import type { User } from "~/lib/users";
import { decodeCursor, encodeCursor, microsToIso, pyFloat, pyInt, pyUuid } from "./cursor";

const ENVELOPE_VERSION = 1;
const DEFAULT_PAGE_SIZE = 500n;
const MAX_PAGE_SIZE = 1000n;
/** DeletionLog.PRUNE_HORIZON_DAYS */
const PRUNE_HORIZON_DAYS = 90;

type PkKind = "uuid" | "int";

interface FeedRequest {
  /** isoformat() text of the cursor datetime (microseconds kept) and the raw id. */
  cursor: { iso: string; pk: string } | null;
  pageSize: number;
}

const error = (status: number, code: string) => json({ error: code }, status);

/** BaseSyncView.get up to the query: cursor decoding (400 / 410) and the page size. */
function parseRequest(q: QueryMap): FeedRequest | Response {
  const raw = q.get("cursor");
  let cursor: FeedRequest["cursor"] = null;
  if (raw) {
    const c = decodeCursor(raw);
    if (!c) return error(400, "invalid_cursor");
    // `cursor_dt < horizon` raises TypeError on Django for a naive datetime.
    if (!c.time.aware) throw ApiError.internal("can't compare offset-naive and offset-aware datetimes");
    const horizon = BigInt(Date.now() - PRUNE_HORIZON_DAYS * 86400_000) * 1000n;
    if (c.time.micros < horizon) return error(410, "cursor_expired");
    cursor = { iso: microsToIso(c.time.micros), pk: c.pk };
  }
  const ps = q.get("page_size");
  let size = ps === undefined ? DEFAULT_PAGE_SIZE : (pyInt(ps) ?? DEFAULT_PAGE_SIZE);
  size = size < 1n ? 1n : size > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : size;
  return { cursor, pageSize: Number(size) };
}

/** ` AND (a.last_modified > dt OR (a.last_modified = dt AND a.id > pk))`, the id parsed as the feed's key. */
function keyset(req: FeedRequest, a: string, kind: PkKind): SQL {
  if (!req.cursor) return sql``;
  const { iso, pk } = req.cursor;
  let pkSql: SQL;
  if (kind === "uuid") {
    const u = pyUuid(pk);
    if (u === null) throw ApiError.internal(`“${pk}” is not a valid UUID.`);
    pkSql = sql`${u}::uuid`;
  } else {
    const n = pyInt(pk);
    if (n === null) throw ApiError.internal(`Field 'id' expected a number but got '${pk}'.`);
    pkSql = sql`${n.toString()}::bigint`;
  }
  const A = sql.raw(a);
  return sql` AND (${A}.last_modified > ${iso}::timestamptz OR (${A}.last_modified = ${iso}::timestamptz AND ${A}.id > ${pkSql}))`;
}

const page = (a: string, req: FeedRequest) => sql` ORDER BY ${sql.raw(a)}.last_modified, ${sql.raw(a)}.id LIMIT ${req.pageSize}`;

/**
 * to_ms: int(dt.timestamp() * 1000) in float arithmetic, truncated toward
 * zero. SQL hands over exact epoch microseconds.
 */
const msOf = (col: string) => sql.raw(`(extract(epoch FROM ${col}) * 1000000)::bigint::text`);
function toMs(micros: string | null): number | null {
  if (micros === null) return null;
  return Math.trunc((Number(micros) / 1e6) * 1000);
}

/** Columns every feed page selects for its cursor: lm_us (epoch micros) and lm_iso (isoformat). */
const lmCols = (a: string) => sql`${msOf(`${a}.last_modified`)} AS lm_us, ${pyIsoTs(`${a}.last_modified`)} AS lm_iso`;

interface PageRow {
  id: string | number;
  lm_us: string;
  lm_iso: string;
}

/** Tombstones for `entity` since the cursor (none on a seed pull), or the seed total. */
async function sideQuery(userId: number, entity: string | null, req: FeedRequest, total: SQL): Promise<{ tombs: string[]; total?: number }> {
  if (!req.cursor) {
    const r = await row<{ n: number }>(total);
    return { tombs: [], total: r?.n ?? 0 };
  }
  if (entity === null) return { tombs: [] };
  const r = await rows<{ entity_id: string }>(
    sql`SELECT entity_id FROM api_deletionlog WHERE owner_id = ${userId} AND entity = ${entity} AND deleted_at > ${req.cursor.iso}::timestamptz`,
  );
  return { tombs: r.map((x) => x.entity_id) };
}

function envelope(items: unknown[], tombs: string[], last: PageRow | undefined, total: number | undefined) {
  const out: Record<string, unknown> = {
    v: ENVELOPE_VERSION,
    items,
    tombstones: tombs,
    next_cursor: last ? encodeCursor(last.lm_iso, String(last.id)) : null,
    server_time: pyIsoDate(new Date()),
  };
  if (total !== undefined) out.total = total;
  return out;
}

/** One feed: the page and the side query run side by side. */
async function feed<R extends PageRow>(
  q: QueryMap,
  user: User,
  kind: PkKind,
  alias: string,
  entity: string | null,
  pageSql: (ks: SQL, pg: SQL) => SQL,
  totalSql: SQL,
  item: (r: R) => unknown,
) {
  const req = parseRequest(q);
  if (req instanceof Response) return req;
  const ks = keyset(req, alias, kind);
  const [rs, side] = await Promise.all([rows<R>(pageSql(ks, page(alias, req))), sideQuery(user.id, entity, req, totalSql)]);
  return envelope(rs.map(item), side.tombs, rs[rs.length - 1], side.total);
}

/** dominant_hex: "[r, g, b]" -> #rrggbb (%02x, so a negative or >255 value prints as Python does), null on anything else. */
export function dominantHex(raw: string | null): string | null {
  if (!raw) return null;
  const chars = Array.from(raw);
  const inner = chars.length >= 2 ? chars.slice(1, -1).join("") : "";
  const parts = inner.split(", ");
  if (parts.length !== 3) return null;
  let out = "#";
  for (const p of parts) {
    const n = pyInt(p);
    if (n === null) return null;
    out += n < 0n ? `-${(-n).toString(16)}` : n.toString(16).padStart(2, "0");
  }
  return out;
}

/** _video_length_ms: int(float(raw) * 1000); unparsable or NaN is null, infinity raises OverflowError on Django (500). */
export function videoLengthMs(raw: string | null): number | null {
  if (!raw) return null;
  const f = pyFloat(raw);
  if (f === null) return null;
  const ms = f * 1000;
  if (Number.isNaN(ms)) return null;
  if (!Number.isFinite(ms)) throw ApiError.internal("cannot convert float infinity to integer");
  return Math.trunc(ms);
}

/** str(uuid) of a membership photo id ("None" for a NULL through row). */
const pyStrUuid = (id: string | null) => (id === null ? "None" : id);

// ------------------------------------------------------------------ feeds

interface PhotoRow extends PageRow {
  image_hash: string;
  owner_id: number;
  ts_us: string | null;
  added_us: string;
  video: boolean;
  video_length: string | null;
  rating: number;
  hidden: boolean;
  in_trashcan: boolean;
  removed: boolean;
  public: boolean;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  aspect_ratio: number | null;
  dominant_color: string | null;
  search_location: string | null;
  favorite_min_rating: number;
  has_motion: boolean;
}

const PHOTO_SCOPE = (userId: number) => ownedOrShared("p", "api_photo_shared_to", "photo_id", userId);

export function photos(q: QueryMap, user: User) {
  return feed<PhotoRow>(
    q,
    user,
    "uuid",
    "p",
    "photo",
    (ks, pg) => sql`SELECT p.id, p.image_hash, p.owner_id, ${msOf("COALESCE(p.exif_timestamp, p.timestamp)")} AS ts_us,
        ${msOf("p.added_on")} AS added_us, ${lmCols("p")}, p.video, p.video_length, p.rating, p.hidden, p.in_trashcan,
        p.removed, p.public, p.exif_gps_lat, p.exif_gps_lon, t.aspect_ratio, t.dominant_color, s.search_location,
        u.favorite_min_rating,
        EXISTS (SELECT 1 FROM api_file_embedded_media em WHERE em.from_file_id = p.main_file_id) AS has_motion
      FROM api_photo p
      JOIN api_user u ON u.id = p.owner_id
      LEFT JOIN api_thumbnail t ON t.photo_id = p.id
      LEFT JOIN api_photo_search s ON s.photo_id = p.id
      WHERE ${PHOTO_SCOPE(user.id)}${ks}${pg}`,
    sql`SELECT count(*)::int AS n FROM api_photo p WHERE ${PHOTO_SCOPE(user.id)}`,
    (r) => ({
      id: r.id,
      image_hash: r.image_hash,
      owner_id: r.owner_id,
      timestamp: toMs(r.ts_us),
      added_on: toMs(r.added_us),
      last_modified: toMs(r.lm_us),
      type: r.video ? "video" : r.has_motion ? "motion" : "image",
      video_length_ms: videoLengthMs(r.video_length),
      rating: r.rating,
      is_favorite: r.favorite_min_rating !== 0 && r.rating >= r.favorite_min_rating,
      hidden: r.hidden,
      in_trashcan: r.in_trashcan,
      removed: r.removed,
      is_public: r.public,
      aspect_ratio: r.aspect_ratio,
      latitude: r.exif_gps_lat,
      longitude: r.exif_gps_lon,
      search_location: r.search_location ?? "",
      dominant_color: dominantHex(r.dominant_color),
    }),
  );
}

interface PersonRow extends PageRow {
  name: string;
  kind: string;
  face_count: number;
  cover_photo_hash: string | null;
}

export function persons(q: QueryMap, user: User) {
  return feed<PersonRow>(
    q,
    user,
    "int",
    "pe",
    "person",
    (ks, pg) => sql`SELECT pe.id, pe.name, pe.kind, pe.face_count, cp.image_hash AS cover_photo_hash, ${lmCols("pe")}
      FROM api_person pe LEFT JOIN api_photo cp ON cp.id = pe.cover_photo_id
      WHERE pe.kind = 'USER' AND pe.cluster_owner_id = ${user.id}${ks}${pg}`,
    sql`SELECT count(*)::int AS n FROM api_person WHERE kind = 'USER' AND cluster_owner_id = ${user.id}`,
    (r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      face_count: r.face_count,
      cover_photo_hash: r.cover_photo_hash,
      last_modified: toMs(r.lm_us),
    }),
  );
}

/** The four album models with a shared_to relation: (album table, through table, through FK). */
const ALBUMS = {
  user: ["api_albumuser", "api_albumuser_shared_to", "albumuser_id"],
  auto: ["api_albumauto", "api_albumauto_shared_to", "albumauto_id"],
  thing: ["api_albumthing", "api_albumthing_shared_to", "albumthing_id"],
  place: ["api_albumplace", "api_albumplace_shared_to", "albumplace_id"],
} as const;

const albumScope = (kind: keyof typeof ALBUMS, userId: number) => ownedOrShared("a", ALBUMS[kind][1], ALBUMS[kind][2], userId);
const albumsTotal = (kind: keyof typeof ALBUMS, userId: number) =>
  sql`SELECT count(*)::int AS n FROM ${sql.raw(ALBUMS[kind][0])} a WHERE ${albumScope(kind, userId)}`;

/**
 * Membership photo ids in Django's scan order (through-row id order: Django
 * reads them with `album_id IN (..)` and no ORDER BY).
 */
const members = (through: string, fk: string) =>
  sql.raw(`(SELECT COALESCE(json_agg(m.photo_id ORDER BY m.id), '[]'::json) FROM ${through} m WHERE m.${fk} = a.id)`);

interface UserAlbumRow extends PageRow {
  title: string;
  owner_id: number;
  favorited: boolean;
  cover_photo_hash: string | null;
  created_us: string;
  photo_ids: (string | null)[];
  shared: boolean;
}

export function userAlbums(q: QueryMap, user: User) {
  return feed<UserAlbumRow>(
    q,
    user,
    "int",
    "a",
    "album_user",
    (ks, pg) => sql`SELECT a.id, a.title, a.owner_id, a.favorited, cp.image_hash AS cover_photo_hash,
        ${msOf("a.created_on")} AS created_us, ${lmCols("a")},
        ${members("api_albumuser_photos", "albumuser_id")} AS photo_ids,
        EXISTS (SELECT 1 FROM api_albumuser_shared_to sh WHERE sh.albumuser_id = a.id) AS shared
      FROM api_albumuser a LEFT JOIN api_photo cp ON cp.id = a.cover_photo_id
      WHERE ${albumScope("user", user.id)}${ks}${pg}`,
    albumsTotal("user", user.id),
    (r) => {
      const ids = r.photo_ids.map(pyStrUuid);
      return {
        id: r.id,
        title: r.title,
        owner_id: r.owner_id,
        favorited: r.favorited,
        shared: r.shared ? 1 : 0,
        cover_hash: r.cover_photo_hash,
        photo_count: ids.length,
        created_on: toMs(r.created_us),
        last_modified: toMs(r.lm_us),
        photo_ids: ids,
      };
    },
  );
}

interface AutoAlbumRow extends PageRow {
  title: string;
  ts_us: string;
  favorited: boolean;
  photo_ids: (string | null)[];
  cover: string | null;
}

export function autoAlbums(q: QueryMap, user: User) {
  return feed<AutoAlbumRow>(
    q,
    user,
    "int",
    "a",
    "album_auto",
    (ks, pg) => sql`SELECT a.id, a.title, ${msOf("a.timestamp")} AS ts_us, a.favorited, ${lmCols("a")},
        ${members("api_albumauto_photos", "albumauto_id")} AS photo_ids,
        (SELECT cp.image_hash FROM (SELECT m.photo_id FROM api_albumauto_photos m WHERE m.albumauto_id = a.id ORDER BY m.id LIMIT 1) f
           LEFT JOIN api_photo cp ON cp.id = f.photo_id) AS cover
      FROM api_albumauto a
      WHERE ${albumScope("auto", user.id)}${ks}${pg}`,
    albumsTotal("auto", user.id),
    (r) => {
      const ids = r.photo_ids.map(pyStrUuid);
      return {
        id: r.id,
        title: r.title,
        timestamp: toMs(r.ts_us),
        favorited: r.favorited,
        photo_count: ids.length,
        cover_hash: r.cover,
        last_modified: toMs(r.lm_us),
        photo_ids: ids,
      };
    },
  );
}

interface NamedAlbumRow extends PageRow {
  title: string;
  photo_count: number;
  geolocation_level?: number | null;
  cover_hashes?: string[];
}

/** serialize_named_album_row (+ extra) */
function namedRow(r: NamedAlbumRow, place: boolean) {
  const v: Record<string, unknown> = {
    id: r.id,
    title: r.title,
    photo_count: r.photo_count,
    cover_hashes: r.cover_hashes ?? [],
    last_modified: toMs(r.lm_us),
  };
  if (place) v.geolocation_level = r.geolocation_level ?? null;
  return v;
}

export function thingAlbums(q: QueryMap, user: User) {
  return feed<NamedAlbumRow>(
    q,
    user,
    "int",
    "a",
    "album_thing",
    (ks, pg) => sql`SELECT a.id, a.title, a.photo_count::int AS photo_count, ${lmCols("a")},
        (SELECT COALESCE(json_agg(p.image_hash ORDER BY c.id), '[]'::json) FROM api_albumthing_cover_photos c
           JOIN api_photo p ON p.id = c.photo_id WHERE c.albumthing_id = a.id AND p.image_hash <> '') AS cover_hashes
      FROM api_albumthing a
      WHERE ${albumScope("thing", user.id)}${ks}${pg}`,
    albumsTotal("thing", user.id),
    (r) => namedRow(r, false),
  );
}

export function placeAlbums(q: QueryMap, user: User) {
  return feed<NamedAlbumRow>(
    q,
    user,
    "int",
    "a",
    "album_place",
    (ks, pg) => sql`SELECT a.id, a.title,
        (SELECT count(m.photo_id)::int FROM api_albumplace_photos m WHERE m.albumplace_id = a.id) AS photo_count,
        a.geolocation_level, ${lmCols("a")}
      FROM api_albumplace a
      WHERE ${albumScope("place", user.id)}${ks}${pg}`,
    albumsTotal("place", user.id),
    (r) => namedRow(r, true),
  );
}

export function tagAlbums(q: QueryMap, user: User) {
  return feed<NamedAlbumRow>(
    q,
    user,
    "int",
    "t",
    "tag",
    (ks, pg) => sql`SELECT t.id, t.name AS title, t.photo_count::int AS photo_count, ${lmCols("t")}
      FROM api_tag t WHERE t.owner_id = ${user.id}${ks}${pg}`,
    sql`SELECT count(*)::int AS n FROM api_tag WHERE owner_id = ${user.id}`,
    (r) => namedRow(r, false),
  );
}

/** Every user on the other side of a share with the viewer, either direction. */
const relevantUsers = (u: number) => sql`
    SELECT st.user_id AS id FROM api_photo_shared_to st JOIN api_photo p ON p.id = st.photo_id WHERE p.owner_id = ${u}
    UNION SELECT s.user_id FROM api_albumuser_shared_to s JOIN api_albumuser a ON a.id = s.albumuser_id WHERE a.owner_id = ${u}
    UNION SELECT s.user_id FROM api_albumauto_shared_to s JOIN api_albumauto a ON a.id = s.albumauto_id WHERE a.owner_id = ${u}
    UNION SELECT s.user_id FROM api_albumthing_shared_to s JOIN api_albumthing a ON a.id = s.albumthing_id WHERE a.owner_id = ${u}
    UNION SELECT s.user_id FROM api_albumplace_shared_to s JOIN api_albumplace a ON a.id = s.albumplace_id WHERE a.owner_id = ${u}
    UNION SELECT p.owner_id FROM api_photo p JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = ${u}
    UNION SELECT a.owner_id FROM api_albumuser a JOIN api_albumuser_shared_to s ON s.albumuser_id = a.id WHERE s.user_id = ${u}
    UNION SELECT a.owner_id FROM api_albumauto a JOIN api_albumauto_shared_to s ON s.albumauto_id = a.id WHERE s.user_id = ${u}
    UNION SELECT a.owner_id FROM api_albumthing a JOIN api_albumthing_shared_to s ON s.albumthing_id = a.id WHERE s.user_id = ${u}
    UNION SELECT a.owner_id FROM api_albumplace a JOIN api_albumplace_shared_to s ON s.albumplace_id = a.id WHERE s.user_id = ${u}`;

interface SharedUserRow extends PageRow {
  username: string;
  first_name: string;
  last_name: string;
  avatar: string | null;
}

export function sharing(q: QueryMap, user: User) {
  return feed<SharedUserRow>(
    q,
    user,
    "int",
    "u",
    // User profiles are not tombstoned.
    null,
    (ks, pg) => sql`WITH rel AS (${relevantUsers(user.id)})
      SELECT u.id, u.username, u.first_name, u.last_name, u.avatar, ${lmCols("u")}
      FROM api_user u WHERE u.id IN (SELECT id FROM rel) AND u.id <> ${user.id}${ks}${pg}`,
    sql`WITH rel AS (${relevantUsers(user.id)}) SELECT count(*)::int AS n FROM api_user u WHERE u.id IN (SELECT id FROM rel) AND u.id <> ${user.id}`,
    (r) => ({
      id: r.id,
      username: r.username,
      first_name: r.first_name,
      last_name: r.last_name,
      avatar_url: r.avatar ? `/media/${r.avatar}` : null,
      last_modified: toMs(r.lm_us),
    }),
  );
}

/** SyncCountsView: one statement. */
export async function counts(user: User) {
  const u = user.id;
  const c = await row<Record<string, number>>(sql`SELECT
      (SELECT count(*)::int FROM api_photo p WHERE ${PHOTO_SCOPE(u)}) AS photos,
      (SELECT count(*)::int FROM api_person pe WHERE pe.kind = 'USER' AND pe.cluster_owner_id = ${u}) AS persons,
      (SELECT count(*)::int FROM api_albumuser a WHERE ${albumScope("user", u)}) AS user_albums,
      (SELECT count(*)::int FROM api_albumauto a WHERE ${albumScope("auto", u)}) AS auto_albums,
      (SELECT count(*)::int FROM api_albumthing a WHERE ${albumScope("thing", u)}) AS thing_albums,
      (SELECT count(*)::int FROM api_albumplace a WHERE ${albumScope("place", u)}) AS place_albums,
      (SELECT count(*)::int FROM api_tag t WHERE t.owner_id = ${u}) AS tags`);
  return {
    photos: c!.photos,
    persons: c!.persons,
    user_albums: c!.user_albums,
    auto_albums: c!.auto_albums,
    thing_albums: c!.thing_albums,
    place_albums: c!.place_albums,
    tags: c!.tags,
    server_time: pyIsoDate(new Date()),
  };
}
