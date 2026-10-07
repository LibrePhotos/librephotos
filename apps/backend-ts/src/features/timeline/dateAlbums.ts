// GET /api/albums/date/list/ and /api/albums/date/{id} (AlbumDateListViewSet,
// AlbumDateViewSet.retrieve): the timeline, the hottest endpoints. Port of
// lp_api::timeline_photos::date_albums + lp_db::timeline_photos::date_albums.
// The list is one grouped query; a day page is one query (authorize the day,
// count, clamp the page like Django's Paginator, fetch the summaries), plus a
// header-only query when that page comes back empty.
import { sql, type SQL } from "drizzle-orm";
import { rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { pigColumns, pigFromRow, PIG_JOINS, type PigPhoto, type PigRow } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { folderScope, hasThumbnail, ownedBy, personScope, photoFiltersFromQuery, stackVisible } from "~/lib/scope";
import type { User } from "~/lib/users";
import { pyInt } from "./common";

/** Frontend page size (hard-coded there too). */
const PAGE_SIZE = 100;

interface TimelineFilter {
  /** Authenticated requester (null = anonymous, only with `public`). */
  viewer: number | null;
  favoriteMinRating: number | null;
  public: boolean;
  username: string | null;
  hidden: boolean;
  inTrashcan: boolean;
  video: boolean;
  photo: boolean;
  isScreenshot: boolean;
  isDocument: boolean;
  person: number | null;
  folder: string | null;
  showAllStackPhotos: boolean;
}

/** Both views: `public` is open to anyone, everything else needs a login (checked before parsing, as in DRF). */
function filterFor(user: User | null, q: QueryMap): TimelineFilter {
  if (!user && !q.flag("public")) throw ApiError.notAuthenticated();
  const f = photoFiltersFromQuery(q);
  const username = q.get("username");
  return {
    viewer: user?.id ?? null,
    favoriteMinRating: user && f.favorite ? user.favoriteMinRating : null,
    public: f.public,
    username: username ? username : null,
    hidden: f.hidden,
    inTrashcan: f.inTrashcan,
    video: f.video,
    photo: f.photo,
    isScreenshot: f.isScreenshot,
    isDocument: f.isDocument,
    person: f.person ?? null,
    folder: f.folder ?? null,
    showAllStackPhotos: f.showAllStackPhotos,
  };
}

/** The requester's own photos (no `public` view). */
const ownerScoped = (f: TimelineFilter) => (f.public ? null : f.viewer);

const usernameIn = (col: string, username: string) =>
  sql`${sql.raw(col)} IN (SELECT uu.id FROM api_user uu WHERE uu.username = ${username})`;

/** Photo-level conditions shared by the list and the day page (all but ownership). */
function photoConditions(f: TimelineFilter): SQL {
  const parts: SQL[] = [hasThumbnail("p"), sql`p.hidden = ${f.hidden}`];
  parts.push(f.inTrashcan ? sql`p.in_trashcan AND NOT p.removed` : sql`NOT p.in_trashcan`);
  if (f.favoriteMinRating !== null) parts.push(sql`p.rating >= ${f.favoriteMinRating}`);
  if (f.public) parts.push(sql`p.public`);
  if (f.video) parts.push(sql`p.video`);
  if (f.photo) parts.push(sql`NOT p.video`);
  if (f.isScreenshot) parts.push(sql`p.is_screenshot`);
  if (f.isDocument) parts.push(sql`p.is_document`);
  if (f.folder !== null) parts.push(folderScope("p", f.folder));
  if (!f.showAllStackPhotos) parts.push(stackVisible("p"));
  if (f.person !== null) parts.push(personScope("p", f.person));
  return sql`(${sql.join(parts, sql` AND `)})`;
}

/**
 * The day's place: `location.places[0]`, or in the public view the city of
 * its first geotagged public photo (`_public_place`). `places` is free-form
 * JSON: a scalar must neither reach jsonb_array_length nor be skipped
 * (Python indexes a string like a list); only CASE fixes evaluation order.
 */
function locationSql(a: string, isPublic: boolean): SQL {
  if (isPublic) {
    const pl = "lp.geolocation_json->'places'";
    return sql.raw(`COALESCE((SELECT CASE jsonb_typeof(${pl}) \
WHEN 'array' THEN ${pl}->>(jsonb_array_length(${pl}) - 2) \
ELSE substr(${pl} #>> '{}', length(${pl} #>> '{}') - 1, 1) END \
FROM api_albumdate_photos lap JOIN api_photo lp ON lp.id = lap.photo_id \
WHERE lap.albumdate_id = ${a}.id AND lp.public AND NOT lp.hidden AND NOT lp.in_trashcan \
AND NOT lp.removed AND CASE jsonb_typeof(${pl}) \
WHEN 'array' THEN jsonb_array_length(${pl}) >= 2 \
WHEN 'string' THEN length(${pl} #>> '{}') >= 2 ELSE false END \
ORDER BY lp.exif_timestamp, lp.id LIMIT 1), '')`);
  }
  const pl = `${a}.location->'places'`;
  return sql.raw(`COALESCE(CASE jsonb_typeof(${pl}) WHEN 'string' THEN substr(${pl} #>> '{}', 1, 1) ELSE ${pl}->>0 END, '')`);
}

interface GroupRow {
  id: number;
  date: string | null;
  location: string;
  photo_count: number;
}

/** IncompleteAlbumDateSerializer list: every day with a matching photo, newest first. */
export async function dateList(user: User | null, q: QueryMap) {
  const f = filterFor(user, q);
  const owner = ownerScoped(f);
  const where: SQL[] = [];
  if (owner !== null) where.push(ownedBy("p", owner));
  where.push(photoConditions(f));
  const outer: SQL[] = [sql`TRUE`];
  if (owner !== null) outer.push(sql`a.owner_id = ${owner}`);
  if (f.public && f.username) outer.push(usernameIn("a.owner_id", f.username));
  // Counted per albumdate_id before the day rows join in, so the wide
  // location JSON is not carried through the per-photo join.
  const rs = await rows<GroupRow>(sql`SELECT a.id, a.date::text AS date, ${locationSql("a", f.public)} AS location, c.n AS photo_count
    FROM (SELECT ap.albumdate_id AS id, count(*)::int AS n FROM api_albumdate_photos ap
      JOIN api_photo p ON p.id = ap.photo_id WHERE ${sql.join(where, sql` AND `)} GROUP BY 1) c
    JOIN api_albumdate a ON a.id = c.id WHERE ${sql.join(outer, sql` AND `)}
    ORDER BY a.date DESC NULLS LAST, a.id`);
  return {
    results: rs.map((r) => ({
      id: String(r.id),
      date: r.date,
      location: r.location,
      incomplete: true,
      numberOfItems: r.photo_count,
      items: [],
    })),
  };
}

/** `_album_date`: the requester's own day, or with `public` a day holding a public photo (of `username`). */
function albumAuth(albumId: number, f: TimelineFilter): SQL {
  const parts: SQL[] = [sql`a.id = ${albumId}`];
  if (f.public) {
    if (f.username) parts.push(usernameIn("a.owner_id", f.username));
    parts.push(sql`EXISTS (SELECT 1 FROM api_albumdate_photos xap JOIN api_photo xp ON xp.id = xap.photo_id
      WHERE xap.albumdate_id = a.id AND xp.public)`);
  } else {
    parts.push(sql`a.owner_id = ${f.viewer ?? -1}`);
  }
  return sql.join(parts, sql` AND `);
}

interface PageRow extends PigRow {
  album_id: number;
  album_date: string | null;
  album_location: string;
  total: number;
}

const notFound = () => ApiError.notFound("No AlbumDate matches the given query.");

/** AlbumDateSerializer: one page of a day. */
export async function datePage(user: User | null, rawId: string, q: QueryMap) {
  const f = filterFor(user, q);
  const t = rawId.trim();
  if (!/^[+-]?\d+$/.test(t)) throw notFound();
  const albumId = Number(t);
  if (albumId > 2147483647 || albumId < -2147483648) throw notFound();
  const pageRaw = pyInt(q.get("page"));
  const page = pageRaw === undefined ? null : pageRaw;
  const sizeRaw = pyInt(q.get("size"));
  const size = sizeRaw !== undefined && sizeRaw > 0 ? sizeRaw : PAGE_SIZE;

  const where: SQL[] = [];
  const owner = ownerScoped(f);
  if (owner !== null) where.push(ownedBy("p", owner));
  if (f.public && f.username) where.push(usernameIn("p.owner_id", f.username));
  where.push(photoConditions(f));
  const loc = locationSql("a", f.public);
  const pageP = sql`${page}::bigint`;
  const sizeP = sql`${size}::bigint`;
  // Django's Paginator: the last page is ceil(total / size), at least 1; a
  // missing page is 1, one out of range is the last.
  const rs = await rows<PageRow>(sql`WITH alb AS (SELECT a.id, a.date::text AS date, ${loc} AS location FROM api_albumdate a WHERE ${albumAuth(albumId, f)}),
    m AS (SELECT p.id, p.exif_timestamp AS ts, mf.path AS mpath FROM alb
      JOIN api_albumdate_photos ap ON ap.albumdate_id = alb.id
      JOIN api_photo p ON p.id = ap.photo_id
      LEFT JOIN api_file mf ON mf.hash = p.main_file_id WHERE ${sql.join(where, sql` AND `)}),
    c AS (SELECT count(*) AS total FROM m),
    lp AS (SELECT total, CASE WHEN total < 1 THEN 1 ELSE (total - 1) / ${sizeP} + 1 END AS last FROM c),
    pg AS (SELECT total, CASE WHEN ${pageP} IS NULL THEN 1 WHEN ${pageP} < 1 OR ${pageP} > last THEN last ELSE ${pageP} END AS page FROM lp),
    sel AS (SELECT m.id, m.ts, m.mpath FROM m ORDER BY m.ts DESC, m.mpath, m.id
      LIMIT ${sizeP} OFFSET (SELECT (pg.page - 1) * ${sizeP} FROM pg))
    SELECT alb.id AS album_id, alb.date AS album_date, alb.location AS album_location, pg.total::int AS total, ${pigColumns()}
    FROM sel JOIN api_photo p ON p.id = sel.id${PIG_JOINS} CROSS JOIN alb CROSS JOIN pg
    ORDER BY sel.ts DESC, sel.mpath, sel.id`);

  let header: { id: number; date: string | null; location: string };
  let total = 0;
  let items: PigPhoto[] = [];
  if (rs.length) {
    header = { id: rs[0].album_id, date: rs[0].album_date, location: rs[0].album_location };
    total = rs[0].total;
    items = rs.map(pigFromRow);
  } else {
    // No rows: either the day is not visible or no photo matches.
    const h = await rows<{ id: number; date: string | null; location: string }>(
      sql`SELECT a.id, a.date::text AS date, ${loc} AS location FROM api_albumdate a WHERE ${albumAuth(albumId, f)}`,
    );
    if (!h.length) throw notFound();
    header = h[0];
  }
  return {
    results: {
      id: String(header.id),
      date: header.date,
      location: header.location,
      incomplete: false,
      numberOfItems: total,
      items,
    },
  };
}
