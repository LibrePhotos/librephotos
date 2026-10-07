// User albums: /albums/user/*, /useralbum/share, /useralbum/makepublic
// (port of lp_api::albums_tags::user_albums, lp_db::albums_tags::user_albums
// and lp_db::write::albums_tags::user_albums).
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db, pgArray, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { drfPage } from "~/lib/pagination";
import { groupByDate, pigColumns, pigFromRow, PIG_JOINS, type DateGroup, type PigPhoto, type PigRow } from "~/lib/pig";
import { pyTruthy, type QueryMap } from "~/lib/query";
import { photoFiltersFromJson } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";
import {
  albumPhotoRows,
  bodyObject,
  boolField,
  charField,
  dictField,
  doesNotExist,
  Errors,
  fetchPage,
  has,
  isI32,
  manyItems,
  mediaFilter,
  pageReq,
  parsePk,
  photoPk,
  pyInt,
  pyStr,
  REQUIRED,
  searchSql,
  searchTerms,
  selectionIds,
  stringList,
  type Exec,
  type MediaFilter,
  type PhotoSelection,
} from "./common";
import { albumsDeleted, clearTombstones, ENTITY, unshared } from "./deletion_log";
import { djangoParseDatetime } from "./datetime";

const SIMPLE_USER = (u: string) =>
  sql.raw(`json_build_object('id', ${u}.id, 'username', ${u}.username, 'first_name', ${u}.first_name, 'last_name', ${u}.last_name)`);
const SHARED_TO = sql.raw(`(SELECT COALESCE(json_agg(json_build_object('id', st.id, 'username', st.username,
      'first_name', st.first_name, 'last_name', st.last_name) ORDER BY st_l.id), '[]'::json)
    FROM api_albumuser_shared_to st_l JOIN api_user st ON st.id = st_l.user_id WHERE st_l.albumuser_id = a.id)`);
const SHARE_COLUMNS = sql`s.id AS share_id, s.enabled AS share_enabled, s.slug AS share_slug,
  ${drfTs("s.expires_at")} AS share_expires_at, s.share_location, s.share_camera_info,
  s.share_timestamps, s.share_captions, s.share_faces`;

interface ShareCols {
  share_id: number | null;
  share_enabled: boolean | null;
  share_slug: string | null;
  share_expires_at: string | null;
  share_location: boolean | null;
  share_camera_info: boolean | null;
  share_timestamps: boolean | null;
  share_captions: boolean | null;
  share_faces: boolean | null;
}

type SimpleUser = { id: number; username: string; first_name: string; last_name: string };

const shareFields = (r: ShareCols) => {
  const has = r.share_id !== null;
  return {
    public: has && !!r.share_enabled,
    public_slug: r.share_slug ?? "",
    public_expires_at: r.share_expires_at,
    public_sharing_options: has
      ? {
          share_location: r.share_location,
          share_camera_info: r.share_camera_info,
          share_timestamps: r.share_timestamps,
          share_captions: r.share_captions,
          share_faces: r.share_faces,
        }
      : null,
  };
};

// ------------------------------------------------------------ list rows

interface ListRow extends ShareCols {
  id: number;
  created_on: string;
  favorited: boolean;
  title: string;
  shared_to: SimpleUser[];
  owner: SimpleUser;
  photo_count: number;
  cover_image_hash: string | null;
  cover_rating: number | null;
  cover_hidden: boolean | null;
  cover_exif_timestamp: string | null;
  cover_public: boolean | null;
  cover_video: boolean | null;
  total_count?: number;
}

function listSelect(nonhiddenCount: boolean, withTotal: boolean): SQL {
  return sql`SELECT a.id, ${drfTs("a.created_on")} AS created_on, a.favorited, a.title, ${SHARED_TO} AS shared_to,
      ${SIMPLE_USER("ow")} AS owner,
      (SELECT count(DISTINCT cp_p.id)::int FROM api_albumuser_photos cp_l JOIN api_photo cp_p ON cp_p.id = cp_l.photo_id
        WHERE cp_l.albumuser_id = a.id${nonhiddenCount ? sql` AND NOT cp_p.hidden` : sql``}) AS photo_count,
      c.image_hash AS cover_image_hash, c.rating AS cover_rating, c.hidden AS cover_hidden,
      ${drfTs("c.exif_timestamp")} AS cover_exif_timestamp, c.public AS cover_public, c.video AS cover_video,
      ${SHARE_COLUMNS}${withTotal ? sql`, count(*) OVER ()::int AS total_count` : sql``}
    FROM api_albumuser a
    JOIN api_user ow ON ow.id = a.owner_id
    LEFT JOIN api_albumusershare s ON s.album_id = a.id
    LEFT JOIN api_photo c ON c.id = COALESCE(a.cover_photo_id,
      (SELECT fl.photo_id FROM api_albumuser_photos fl WHERE fl.albumuser_id = a.id AND fl.photo_id IS NOT NULL
        ORDER BY fl.photo_id LIMIT 1))`;
}

type ListKind = { kind: "owned"; ownerId: number; search: string[] } | { kind: "fromme"; ownerId: number } | { kind: "tome"; userId: number };

function listQuery(k: ListKind, limit: number, offset: number): SQL {
  const page = sql` LIMIT ${limit} OFFSET ${offset}`;
  switch (k.kind) {
    case "owned":
      // The window must count only albums that survive photo_count > 0.
      return sql`SELECT *, count(*) OVER ()::int AS total_count FROM (${listSelect(true, false)}
        WHERE a.owner_id = ${k.ownerId}${searchSql(["a.title"], k.search)}) x
        WHERE x.photo_count > 0 ORDER BY x.title, x.id${page}`;
    case "fromme":
      return sql`${listSelect(false, true)} WHERE a.owner_id = ${k.ownerId}
        AND EXISTS (SELECT 1 FROM api_albumuser_shared_to x WHERE x.albumuser_id = a.id) ORDER BY a.id${page}`;
    case "tome":
      return sql`${listSelect(false, true)} WHERE EXISTS (SELECT 1 FROM api_albumuser_shared_to x
        WHERE x.albumuser_id = a.id AND x.user_id = ${k.userId}) ORDER BY a.id${page}`;
  }
}

/** AlbumUserListSerializer. */
function listItem(r: ListRow) {
  return {
    id: r.id,
    cover_photo:
      r.cover_image_hash !== null
        ? {
            image_hash: r.cover_image_hash,
            rating: r.cover_rating,
            hidden: r.cover_hidden ?? false,
            exif_timestamp: r.cover_exif_timestamp,
            public: r.cover_public ?? false,
            video: r.cover_video ?? false,
          }
        : { image_hash: "", rating: null, hidden: false, exif_timestamp: null, public: false, video: false },
    created_on: r.created_on,
    favorited: r.favorited,
    title: r.title,
    shared_to: r.shared_to,
    owner: r.owner,
    photo_count: r.photo_count,
    ...shareFields(r),
  };
}

async function listPage(req: Request, q: QueryMap, kind: ListKind, def: number, max: number) {
  const { req: pr, paged } = await fetchPage<ListRow>(pageReq(q, def, max), (l, o) => listQuery(kind, l, o));
  return drfPage(req, pr, paged.total, paged.rows.map(listItem));
}

/** GET /api/albums/user/list/ */
export const ownedList = (user: User, req: Request, q: QueryMap) =>
  listPage(req, q, { kind: "owned", ownerId: user.id, search: searchTerms(q.get("search")) }, 1000, 2000);
/** GET /api/albums/user/shared/fromme/ */
export const sharedFromMe = (user: User, req: Request, q: QueryMap) => listPage(req, q, { kind: "fromme", ownerId: user.id }, 2500, 5000);
/** GET /api/albums/user/shared/tome/ */
export const sharedToMe = (user: User, req: Request, q: QueryMap) => listPage(req, q, { kind: "tome", userId: user.id }, 2500, 5000);

async function albumListItem(id: number, tx: Exec = db) {
  const r = await row<ListRow>(sql`${listSelect(false, false)} WHERE a.id = ${id}`, tx);
  if (!r) throw ApiError.notFound();
  return listItem(r);
}

// ----------------------------------------------------------- detail rows

interface DetailRow extends ShareCols {
  id: number;
  title: string;
  owner_id: number;
  owner: SimpleUser;
  owner_sharing_defaults: unknown;
  shared_to: SimpleUser[];
  first_timestamp: string | null;
  first_location: string | null;
  total_count: number;
}

/** Who may open the album detail. */
type DetailScope = { kind: "visible"; userId: number; write: boolean } | { kind: "public"; username?: string };

// "The first photo" of the unordered membership: Django iterates
// obj.photos.all(), which Postgres answers in heap order (ctid).
const DETAIL_SELECT = sql`SELECT a.id, a.title, a.owner_id, ${SIMPLE_USER("ow")} AS owner,
    ow.public_sharing_defaults AS owner_sharing_defaults, ${SHARED_TO} AS shared_to, ${SHARE_COLUMNS},
    (SELECT ${drfTs("p.exif_timestamp")} FROM api_albumuser_photos l JOIN api_photo p ON p.id = l.photo_id
      WHERE l.albumuser_id = a.id AND p.exif_timestamp IS NOT NULL ORDER BY p.ctid LIMIT 1) AS first_timestamp,
    (SELECT ps.search_location FROM api_albumuser_photos l JOIN api_photo p ON p.id = l.photo_id
      JOIN api_photo_search ps ON ps.photo_id = p.id
      WHERE l.albumuser_id = a.id AND ps.search_location IS NOT NULL AND ps.search_location <> ''
      ORDER BY p.ctid LIMIT 1) AS first_location,
    count(*) OVER ()::int AS total_count
  FROM api_albumuser a JOIN api_user ow ON ow.id = a.owner_id LEFT JOIN api_albumusershare s ON s.album_id = a.id`;

function scopeSql(s: DetailScope): SQL {
  if (s.kind === "visible") {
    const shared = s.write
      ? sql``
      : sql` OR EXISTS (SELECT 1 FROM api_albumuser_shared_to x WHERE x.albumuser_id = a.id AND x.user_id = ${s.userId})`;
    return sql` AND (a.owner_id = ${s.userId}${shared})`;
  }
  const name = s.username !== undefined ? sql` AND ow.username = ${s.username}` : sql``;
  return sql` AND s.enabled AND (s.expires_at IS NULL OR s.expires_at >= now())${name}`;
}

const notFoundAlbum = () => ApiError.notFound("No AlbumUser matches the given query.");

async function detailRow(id: number, scope: DetailScope, tx: Exec = db): Promise<DetailRow> {
  const r = await row<DetailRow>(sql`${DETAIL_SELECT} WHERE a.id = ${id}${scopeSql(scope)}`, tx);
  if (!r) throw notFoundAlbum();
  return r;
}

/** AlbumUserSerializer of `r` with its (media-filtered) members. */
function detailBody(r: DetailRow, photos: PigRow[]) {
  return {
    id: String(r.id),
    title: r.title,
    owner: r.owner,
    shared_to: r.shared_to,
    date: r.first_timestamp ?? "",
    location: r.first_location ?? "",
    grouped_photos: groupByDate(photos),
    ...shareFields(r),
  };
}

/** get_effective_sharing_settings: all off, owner defaults, album overrides. */
function effective(r: DetailRow): { location: boolean; timestamps: boolean } {
  let location = false;
  let timestamps = false;
  const d = r.owner_sharing_defaults;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const o = d as Record<string, unknown>;
    if (has(o, "share_location")) location = pyTruthy(o.share_location);
    if (has(o, "share_timestamps")) timestamps = pyTruthy(o.share_timestamps);
  }
  if (r.share_id !== null) {
    if (r.share_location !== null) location = r.share_location;
    if (r.share_timestamps !== null) timestamps = r.share_timestamps;
  }
  return { location, timestamps };
}

const keep = (m: MediaFilter, r: PigRow) => (m === "all" ? true : m === "videos" ? r.video : !r.video);

type PublicGroup = { date: string | null; location: string; items: PigPhoto[] };

/**
 * AlbumUserPublicSerializer of `r` with all its non-hidden, untrashed members
 * newest first (public_slug / public_expires_at are declared but skipped by DRF).
 */
function publicBody(r: DetailRow, all: PigRow[], media: MediaFilter) {
  const eff = effective(r);
  const date = eff.timestamps ? (all.find((p) => p.date_drf !== null)?.date_drf ?? "") : "";
  const location = eff.location ? (all.find((p) => p.search_location)?.search_location ?? "") : "";
  const photos = all.filter((p) => keep(media, p));
  let groups: PublicGroup[];
  if (eff.timestamps) groups = groupByDate(photos);
  else groups = photos.length ? [{ date: null, location: "", items: photos.map(pigFromRow) }] : [];
  for (const g of groups)
    for (const item of g.items) {
      if (!eff.location) {
        item.exif_gps_lat = null;
        item.exif_gps_lon = null;
        item.location = "";
      }
      if (!eff.timestamps) {
        item.date = "";
        item.birthTime = "";
      }
    }
  return { id: String(r.id), title: r.title, owner: r.owner, date, location, grouped_photos: groups };
}

async function detailResponse(r: DetailRow, q: QueryMap) {
  return detailBody(r, await albumPhotoRows({ kind: "user", id: r.id, public: false }, mediaFilter(q)));
}

/** GET /api/albums/user/{id}/ (`?public=` = anonymous view of an active share). */
export async function detail(user: User | null, rawId: string, q: QueryMap) {
  if (q.flag("public")) {
    const id = parsePk(rawId);
    const r = await detailRow(id, { kind: "public", username: q.nonEmpty("username") });
    const all = await albumPhotoRows({ kind: "user", id, public: true }, "all");
    return publicBody(r, all, mediaFilter(q));
  }
  if (!user) throw ApiError.notAuthenticated();
  const r = await detailRow(parsePk(rawId), { kind: "visible", userId: user.id, write: false });
  return detailResponse(r, q);
}

const ownedDetail = (user: User, rawId: string) => detailRow(parsePk(rawId), { kind: "visible", userId: user.id, write: true });

/** GET /api/albums/user/ (AlbumUserViewSet.list). */
export async function viewsetList(user: User | null, req: Request, q: QueryMap) {
  const pub = q.flag("public");
  let scope: DetailScope;
  if (pub) scope = { kind: "public", username: q.nonEmpty("username") };
  else {
    if (!user) throw ApiError.notAuthenticated();
    scope = { kind: "visible", userId: user.id, write: false };
  }
  const { req: pr, paged } = await fetchPage<DetailRow>(
    pageReq(q),
    (l, o) => sql`${DETAIL_SELECT} WHERE TRUE${scopeSql(scope)} ORDER BY a.id DESC LIMIT ${l} OFFSET ${o}`,
  );
  // Every album's members in one statement, not one per album.
  const ids = paged.rows.map((r) => r.id);
  const members = new Map<number, PigRow[]>();
  if (ids.length) {
    const rule = pub ? sql` AND NOT p.hidden AND NOT p.in_trashcan` : sql``;
    const rs = await rows<PigRow & { album_id: number }>(
      sql`SELECT l.albumuser_id AS album_id, ${pigColumns()} FROM api_albumuser_photos l
          JOIN api_photo p ON p.id = l.photo_id${PIG_JOINS}
          WHERE l.albumuser_id = ANY(${pgArray(ids, "int")})${rule} ORDER BY p.exif_timestamp DESC, p.id`,
    );
    for (const r of rs) {
      const list = members.get(r.album_id);
      if (list) list.push(r);
      else members.set(r.album_id, [r]);
    }
  }
  const media = mediaFilter(q);
  const results = paged.rows.map((r) => {
    const all = members.get(r.id) ?? [];
    return pub ? publicBody(r, all, media) : detailBody(r, all.filter((p) => keep(media, p)));
  });
  return drfPage(req, pr, paged.total, results);
}

/** POST /api/albums/user/ (AlbumUserViewSet.create): an empty album, 201. */
export async function viewsetCreate(user: User, req: Request, q: QueryMap) {
  const obj = bodyObject(await jsonBody(req));
  const e = new Errors();
  let title: string | undefined;
  if (has(obj, "title")) title = e.check("title", charField(obj.title, 512));
  else e.add("title", REQUIRED);
  e.throwIfAny();
  const created = await row<{ id: number }>(
    sql`INSERT INTO api_albumuser (title, created_on, favorited, owner_id, cover_photo_id, last_modified)
        VALUES (${title!}, now(), FALSE, ${user.id}, NULL, now()) RETURNING id`,
  );
  const r = await ownedDetail(user, String(created!.id));
  return json(await detailResponse(r, q), 201);
}

/** PATCH / PUT /api/albums/user/{id}/: rename (owner only; recipients get 404). */
export async function saveTitle(user: User, rawId: string, req: Request, q: QueryMap, partial: boolean) {
  const r = await ownedDetail(user, rawId);
  const obj = bodyObject(await jsonBody(req));
  const e = new Errors();
  let title: string | undefined;
  if (has(obj, "title")) title = e.check("title", charField(obj.title, 512));
  else if (!partial) e.add("title", REQUIRED);
  e.throwIfAny();
  await rows(
    sql`UPDATE api_albumuser SET title = COALESCE(${title ?? null}::varchar, title), created_on = now(), last_modified = now() WHERE id = ${r.id}`,
  );
  return detailResponse(await ownedDetail(user, rawId), q);
}

async function deleteAlbum(id: number) {
  await db.transaction(async (tx) => {
    await albumsDeleted(tx, ENTITY.albumUser, [id]);
    await rows(sql`DELETE FROM api_albumuser_photos WHERE albumuser_id = ${id}`, tx);
    await rows(sql`DELETE FROM api_albumuser_shared_to WHERE albumuser_id = ${id}`, tx);
    await rows(sql`DELETE FROM api_albumusershare WHERE album_id = ${id}`, tx);
    await rows(sql`DELETE FROM api_albumuser WHERE id = ${id}`, tx);
  });
}

/** DELETE /api/albums/user/{id}/ (owner only). */
export async function remove(user: User, rawId: string) {
  const r = await ownedDetail(user, rawId);
  await deleteAlbum(r.id);
  return new Response(null, { status: 204 });
}

// ------------------------------------------------------------ edit viewset

interface EditRow {
  id: number;
  title: string;
  photos: string[];
  created_on: string;
  favorited: boolean;
  cover_photo_id: string | null;
  total_count?: number;
}

// `photos` is the unordered obj.photos.all(): link order on Postgres.
const EDIT_SELECT = sql`SELECT a.id, a.title,
    (SELECT COALESCE(json_agg(l.photo_id ORDER BY l.id), '[]'::json) FROM api_albumuser_photos l
      WHERE l.albumuser_id = a.id AND l.photo_id IS NOT NULL) AS photos,
    ${drfTs("a.created_on")} AS created_on, a.favorited, a.cover_photo_id`;

const editOut = (r: EditRow) => ({
  id: r.id,
  title: r.title,
  photos: r.photos,
  created_on: r.created_on,
  favorited: r.favorited,
  cover_photo: r.cover_photo_id,
});

async function editRow(id: number) {
  return editOut((await row<EditRow>(sql`${EDIT_SELECT} FROM api_albumuser a WHERE a.id = ${id}`))!);
}

async function ownedEditId(user: User, rawId: string): Promise<number> {
  const id = parsePk(rawId);
  const r = await row<{ id: number }>(sql`SELECT id FROM api_albumuser WHERE id = ${id} AND owner_id = ${user.id}`);
  if (!r) throw notFoundAlbum();
  return r.id;
}

/** GET /api/albums/user/edit/: the owner's albums by title. */
export async function editList(user: User, req: Request, q: QueryMap) {
  const { req: pr, paged } = await fetchPage<EditRow>(
    pageReq(q),
    (l, o) => sql`${EDIT_SELECT}, count(*) OVER ()::int AS total_count FROM api_albumuser a
      WHERE a.owner_id = ${user.id} ORDER BY a.title, a.id LIMIT ${l} OFFSET ${o}`,
  );
  return drfPage(req, pr, paged.total, paged.rows.map(editOut));
}

export const editRetrieve = async (user: User, rawId: string) => editRow(await ownedEditId(user, rawId));

export async function editDelete(user: User, rawId: string) {
  await deleteAlbum(await ownedEditId(user, rawId));
  return new Response(null, { status: 204 });
}

interface EditInput {
  title?: string;
  photos?: string[];
  removed?: string[];
  /** null clears the cover; undefined leaves it. */
  cover?: string | null;
  selectAll: boolean;
  query?: Record<string, unknown>;
  excluded: string[];
}

type R<T> = { ok: true; value: T } | { ok: false; error: string };

/** Owner-scoped OwnedPhotoField values; the first bad item (in order) is the error. */
async function ownedPhotos(user: User, items: unknown[]): Promise<R<string[]>> {
  const parsed = items.map(photoPk);
  const ids = parsed.flatMap((p) => (p.ok ? [p.value] : []));
  const owned = new Set(
    ids.length
      ? (await rows<{ id: string }>(sql`SELECT id FROM api_photo WHERE owner_id = ${user.id} AND id = ANY(${pgArray(ids, "uuid")})`)).map(
          (r) => r.id,
        )
      : [],
  );
  for (let i = 0; i < items.length; i++) {
    const p = parsed[i];
    if (!p.ok) return p;
    if (!owned.has(p.value)) return { ok: false, error: doesNotExist(items[i]) };
  }
  return { ok: true, value: ids };
}

async function validateEdit(user: User, body: unknown, creating: boolean): Promise<EditInput> {
  const obj = bodyObject(body);
  const e = new Errors();
  const out: EditInput = { selectAll: false, excluded: [] };
  if (has(obj, "title")) out.title = e.check("title", charField(obj.title, 512));
  else if (creating) e.add("title", REQUIRED);
  if (has(obj, "photos")) {
    const items = manyItems(obj.photos);
    if (items.ok) out.photos = e.check("photos", await ownedPhotos(user, items.value));
    else e.add("photos", items.error);
  } else if (creating) e.add("photos", REQUIRED);
  if (has(obj, "favorited")) e.check("favorited", boolField(obj.favorited));
  if (has(obj, "removedPhotos")) out.removed = e.check("removedPhotos", stringList(obj.removedPhotos, 100));
  if (has(obj, "cover_photo")) {
    if (obj.cover_photo === null) out.cover = null;
    else {
      const c = e.check("cover_photo", await ownedPhotos(user, [obj.cover_photo]));
      if (c) out.cover = c[0];
    }
  }
  if (has(obj, "select_all")) out.selectAll = e.check("select_all", boolField(obj.select_all)) ?? false;
  if (has(obj, "query")) out.query = e.check("query", dictField(obj.query));
  if (has(obj, "excluded_hashes")) out.excluded = e.check("excluded_hashes", stringList(obj.excluded_hashes, 100)) ?? [];
  e.throwIfAny();
  return out;
}

function additions(user: User, input: EditInput): PhotoSelection | undefined {
  if (input.selectAll)
    return {
      kind: "all",
      ownerId: user.id,
      favoriteMinRating: user.favoriteMinRating,
      params: photoFiltersFromJson(input.query ?? {}),
      excludedHashes: input.excluded,
    };
  return input.photos ? { kind: "ids", ids: input.photos } : undefined;
}

async function addPhotos(tx: Exec, albumId: number, sel: PhotoSelection) {
  await rows(
    sql`INSERT INTO api_albumuser_photos (albumuser_id, photo_id) SELECT ${albumId}::int, s.id FROM (${selectionIds(sel)}) s
        ON CONFLICT DO NOTHING`,
    tx,
  );
}

/** AlbumUserEditSerializer.update, in Django's order. */
async function applyEdit(tx: Exec, albumId: number, input: EditInput, add: PhotoSelection | undefined) {
  if (input.removed)
    await rows(
      sql`DELETE FROM api_albumuser_photos WHERE albumuser_id = ${albumId}
          AND photo_id IN (SELECT p.id FROM api_photo p WHERE p.image_hash = ANY(${pgArray(input.removed, "text")}))`,
      tx,
    );
  if (add) await addPhotos(tx, albumId, add);
  // instance.save(): auto_now created_on and last_modified.
  await rows(
    sql`UPDATE api_albumuser SET title = COALESCE(${input.title ?? null}::varchar, title),
        cover_photo_id = CASE WHEN ${input.cover !== undefined} THEN ${input.cover ?? null}::uuid ELSE cover_photo_id END,
        created_on = now(), last_modified = now() WHERE id = ${albumId}`,
    tx,
  );
}

/** POST /api/albums/user/edit/: get_or_create(title, owner); an existing album is updated. */
export async function editCreate(user: User, req: Request) {
  const input = await validateEdit(user, await jsonBody(req), true);
  const add = additions(user, input);
  const title = input.title ?? "";
  const id = await db.transaction(async (tx) => {
    // Look first: INSERT .. ON CONFLICT would burn an id on every existing title.
    const existing = await row<{ id: number }>(sql`SELECT id FROM api_albumuser WHERE title = ${title} AND owner_id = ${user.id}`, tx);
    if (existing) {
      await applyEdit(tx, existing.id, input, add);
      return existing.id;
    }
    const created = await row<{ id: number }>(
      sql`INSERT INTO api_albumuser (title, created_on, favorited, owner_id, cover_photo_id, last_modified)
          VALUES (${title}, now(), FALSE, ${user.id}, NULL, now()) RETURNING id`,
      tx,
    );
    // A new album only takes the photos (Django's create ignores the rest).
    if (add) await addPhotos(tx, created!.id, add);
    return created!.id;
  });
  return json(await editRow(id), 201);
}

/** PATCH / PUT /api/albums/user/edit/{id}/. */
export async function editSave(user: User, rawId: string, req: Request, partial: boolean) {
  const id = await ownedEditId(user, rawId);
  const input = await validateEdit(user, await jsonBody(req), !partial);
  const add = additions(user, input);
  await db.transaction((tx) => applyEdit(tx, id, input, add));
  return editRow(id);
}

// ------------------------------------------------------------ sharing

const statusMessage = (status: number, message: string) => json({ status: false, message }, status);

/** A request value used as an integer pk: null = Python None, throws = Python raises (500). */
function lookupInt(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = pyInt(v);
  if (n === undefined) throw ApiError.internal("invalid integer lookup");
  return isI32(n) ? n : null;
}

async function ownerOf(id: number | null): Promise<number | undefined> {
  if (id === null) return undefined;
  return (await row<{ owner_id: number }>(sql`SELECT owner_id FROM api_albumuser WHERE id = ${id}`))?.owner_id;
}

/** POST /api/useralbum/share/ (SetUserAlbumShared). */
export async function share(user: User, req: Request) {
  const obj = bodyObject(await jsonBody(req));
  if (!has(obj, "shared") || !has(obj, "target_user_id") || !has(obj, "album_id")) throw ApiError.internal("missing share parameters");
  const targetId = lookupInt(obj.target_user_id);
  const target = targetId === null ? undefined : await row<{ id: number }>(sql`SELECT id FROM api_user WHERE id = ${targetId}`);
  if (!target) return statusMessage(400, "No such user");
  const albumId = lookupInt(obj.album_id);
  const owner = await ownerOf(albumId);
  if (owner === undefined) return statusMessage(400, "No such album");
  if (owner !== user.id) return statusMessage(400, "You cannot share an album you don't own");
  const album = [String(albumId)];
  return db.transaction(async (tx) => {
    if (pyTruthy(obj.shared)) {
      const added = await rows(
        sql`INSERT INTO api_albumuser_shared_to (albumuser_id, user_id) VALUES (${albumId}, ${target.id}) ON CONFLICT DO NOTHING RETURNING 1`,
        tx,
      );
      // shared_to.add: a newly added recipient's stale tombstone goes.
      if (added.length) await clearTombstones(tx, ENTITY.albumUser, album, [target.id]);
    } else {
      await rows(sql`DELETE FROM api_albumuser_shared_to WHERE albumuser_id = ${albumId} AND user_id = ${target.id}`, tx);
      await unshared(tx, ENTITY.albumUser, album, [target.id]);
    }
    await rows(sql`UPDATE api_albumuser SET created_on = now(), last_modified = now() WHERE id = ${albumId}`, tx);
    return albumListItem(albumId!, tx);
  });
}

const OPTION_FIELDS = ["share_location", "share_camera_info", "share_timestamps", "share_captions", "share_faces"] as const;
type OptionField = (typeof OPTION_FIELDS)[number];

/** BooleanField(null=True) coercion of a sharing option (throws = 500). */
function nullableBool(v: unknown): boolean | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === "string") {
    if (v === "t" || v === "True" || v === "1") return true;
    if (v === "f" || v === "False" || v === "0") return false;
    if (v === "") return null;
  }
  if (Array.isArray(v) && v.length === 0) return null;
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return null;
  throw ApiError.internal("invalid sharing option");
}

interface ShareRow {
  id: number;
  slug: string | null;
  expires_at: string | null;
  share_location: boolean | null;
  share_camera_info: boolean | null;
  share_timestamps: boolean | null;
  share_captions: boolean | null;
  share_faces: boolean | null;
}

/** POST /api/useralbum/makepublic (SetUserAlbumPublic). */
export async function makePublic(user: User, req: Request) {
  const obj = bodyObject(await jsonBody(req));
  const album = obj.album_id ?? null;
  const valPublic = obj.val_public ?? null;
  if (album === null || valPublic === null) return statusMessage(400, "Missing parameters");
  const albumId = lookupInt(album);
  const owner = await ownerOf(albumId);
  if (owner === undefined) return statusMessage(404, "No such album");
  if (owner !== user.id) return statusMessage(403, "You are not the owner of this album");
  const enabled = pyTruthy(valPublic);
  // undefined = not in the request.
  let slug: string | null | undefined;
  if (obj.slug !== undefined && obj.slug !== null) slug = pyTruthy(obj.slug) ? pyStr(obj.slug) : null;
  let expires: { set: string | null } | undefined;
  if (typeof obj.expires_at === "string") {
    const parsed = djangoParseDatetime(obj.expires_at);
    if (parsed !== undefined) expires = { set: parsed };
  }
  const options: Partial<Record<OptionField, boolean | null>> = {};
  const so = obj.sharing_options;
  if (so && typeof so === "object" && !Array.isArray(so)) {
    for (const f of OPTION_FIELDS) if (has(so as Record<string, unknown>, f)) options[f] = nullableBool((so as Record<string, unknown>)[f]);
  }
  await db.transaction(async (tx) => {
    const existing = await row<ShareRow>(
      sql`SELECT id, slug, expires_at::text AS expires_at, share_location, share_camera_info, share_timestamps, share_captions, share_faces
          FROM api_albumusershare WHERE album_id = ${albumId} FOR UPDATE`,
      tx,
    );
    const r: ShareRow = existing ?? {
      id: 0,
      slug: null,
      expires_at: null,
      share_location: null,
      share_camera_info: null,
      share_timestamps: null,
      share_captions: null,
      share_faces: null,
    };
    if (slug !== undefined) r.slug = slug || null;
    if (expires) r.expires_at = expires.set;
    for (const f of OPTION_FIELDS) if (f in options) r[f] = options[f] ?? null;
    if (!enabled) r.slug = null;
    if (enabled && r.slug === null) {
      // S17: 12 hex chars, -N on a clash.
      const base = randomUUID().replaceAll("-", "").slice(0, 12);
      let candidate = base;
      for (let i = 1; ; i++) {
        const clash = await row<{ c: boolean }>(
          sql`SELECT EXISTS (SELECT 1 FROM api_albumusershare WHERE slug = ${candidate} AND id <> ${r.id}) AS c`,
          tx,
        );
        if (!clash!.c) break;
        candidate = `${base}-${i}`;
      }
      r.slug = candidate;
    }
    const opt = (f: OptionField) => sql`${r[f]}::boolean`;
    if (existing)
      await rows(
        sql`UPDATE api_albumusershare SET enabled = ${enabled}, slug = ${r.slug}::varchar, expires_at = ${r.expires_at}::timestamptz,
            share_location = ${opt("share_location")}, share_camera_info = ${opt("share_camera_info")},
            share_timestamps = ${opt("share_timestamps")}, share_captions = ${opt("share_captions")}, share_faces = ${opt("share_faces")}
            WHERE album_id = ${albumId}`,
        tx,
      );
    else
      await rows(
        sql`INSERT INTO api_albumusershare (album_id, enabled, slug, expires_at, share_location, share_camera_info, share_timestamps, share_captions, share_faces)
            VALUES (${albumId}, ${enabled}, ${r.slug}::varchar, ${r.expires_at}::timestamptz, ${opt("share_location")}, ${opt("share_camera_info")},
              ${opt("share_timestamps")}, ${opt("share_captions")}, ${opt("share_faces")})`,
        tx,
      );
  });
  return { status: true, album: await albumListItem(albumId!) };
}

export type { DateGroup };
