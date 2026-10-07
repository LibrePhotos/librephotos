// Tags (TagViewSet): list, detail, create, rename, delete, add/remove photos,
// merge. Another account's tag behaves like a missing one. Port of
// lp_api::albums_tags::tags, lp_db::albums_tags::tags, lp_db::write::albums_tags::tags.
// Every photo-link change runs Django's m2m_changed receivers: the visible
// photo recount (S2) and the sync bump of last_modified.
import { sql } from "drizzle-orm";
import { db, pgArray, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { drfPage } from "~/lib/pagination";
import { pyTruthy, type QueryMap } from "~/lib/query";
import { photoFiltersFromJson, visibleManager } from "~/lib/scope";
import type { User } from "~/lib/users";
import {
  albumPhotoRows,
  bodyObject,
  charField,
  Errors,
  fetchPage,
  grouped,
  has,
  isI32,
  mediaFilter,
  pageReq,
  pyInt,
  pyStr,
  REQUIRED,
  searchSql,
  searchTerms,
  selectionIds,
  type Exec,
  type PhotoSelection,
} from "./common";
import { tagsDeleted } from "./deletion_log";

interface TagRow {
  id: number;
  name: string;
  photo_count: number;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** _get_photo_filter_kwargs: a UUID when it looks like one, else an image hash. */
const photoRef = (v: string): { id: string } | { hash: string } => (UUID_RE.test(v) ? { id: v.toLowerCase() } : { hash: v });

/** GET /api/tags/ (`?photo=<id or hash>` narrows to one photo's tags). */
export async function list(user: User, req: Request, q: QueryMap) {
  const photo = q.nonEmpty("photo");
  const ref = photo === undefined ? undefined : photoRef(photo);
  const filter =
    ref === undefined
      ? sql``
      : "id" in ref
        ? sql` AND EXISTS (SELECT 1 FROM api_tag_photos fl WHERE fl.tag_id = t.id AND fl.photo_id = ${ref.id}::uuid)`
        : sql` AND EXISTS (SELECT 1 FROM api_tag_photos fl JOIN api_photo fp ON fp.id = fl.photo_id
               WHERE fl.tag_id = t.id AND fp.image_hash = ${ref.hash})`;
  const search = searchTerms(q.get("search"));
  const { req: pr, paged } = await fetchPage<TagRow & { cover_photos: unknown; total_count: number }>(
    pageReq(q),
    (l, o) => sql`SELECT t.id, t.name, t.photo_count,
        (SELECT COALESCE(json_agg(c.j ORDER BY c.lid), '[]'::json) FROM (
          SELECT json_build_object('image_hash', p.image_hash, 'video', p.video) AS j, cl.id AS lid FROM api_tag_photos cl
            JOIN api_photo p ON p.id = cl.photo_id WHERE cl.tag_id = t.id AND ${visibleManager("p")} ORDER BY cl.id LIMIT 4) c) AS cover_photos,
        count(*) OVER ()::int AS total_count
      FROM api_tag t WHERE t.owner_id = ${user.id}${filter}${searchSql(["t.name"], search)}
      ORDER BY t.name, t.id LIMIT ${l} OFFSET ${o}`,
  );
  return drfPage(
    req,
    pr,
    paged.total,
    paged.rows.map((r) => ({ id: r.id, name: r.name, photo_count: r.photo_count, cover_photos: r.cover_photos })),
  );
}

const ownedById = (id: number, ownerId: number, tx: Exec = db) =>
  row<TagRow>(sql`SELECT id, name, photo_count FROM api_tag WHERE id = ${id} AND owner_id = ${ownerId}`, tx);

async function ownedTag(user: User, rawId: string): Promise<TagRow> {
  const t = rawId.trim();
  const id = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  if (!isI32(id)) throw ApiError.notFound();
  const tag = await ownedById(id, user.id);
  if (!tag) throw ApiError.notFound("No Tag matches the given query.");
  return tag;
}

/** GET /api/tags/{id}/ -> {"results": {id, name, grouped_photos}} */
export async function detail(user: User, rawId: string, q: QueryMap) {
  const tag = await ownedTag(user, rawId);
  const photos = await albumPhotoRows({ kind: "tag", id: tag.id }, mediaFilter(q));
  return { results: { id: tag.id, name: tag.name, grouped_photos: grouped(photos) } };
}

/** TagSerializer.validate_name after the CharField checks. */
async function validateName(user: User, value: unknown, except: number | null): Promise<string> {
  const e = new Errors();
  const name = e.check("name", charField(value, 512));
  if (name !== undefined) {
    const taken = await row<{ t: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM api_tag WHERE name = ${name} AND owner_id = ${user.id}
          AND (${except}::int IS NULL OR id <> ${except}::int)) AS t`,
    );
    if (taken!.t) e.add("name", `Tag '${name}' already exists.`);
  }
  e.throwIfAny();
  return name!;
}

/** POST /api/tags/: an existing name answers 200 with that tag. */
export async function create(user: User, req: Request) {
  const obj = bodyObject(await jsonBody(req));
  // str(request.data.get("name") or "").strip()
  const probe = pyTruthy(obj.name) ? pyStr(obj.name).trim() : "";
  const existing = await row<TagRow>(sql`SELECT id, name, photo_count FROM api_tag WHERE name = ${probe} AND owner_id = ${user.id}`);
  if (existing) return existing;
  if (!has(obj, "name")) throw ApiError.badRequest("name", REQUIRED);
  const name = await validateName(user, obj.name, null);
  const tag = await row<TagRow>(
    sql`INSERT INTO api_tag (name, photo_count, owner_id, last_modified) VALUES (${name}, 0, ${user.id}, now())
        RETURNING id, name, photo_count`,
  );
  return json(tag, 201);
}

/** PATCH / PUT /api/tags/{id}/ */
export async function saveName(user: User, rawId: string, req: Request, partial: boolean) {
  const tag = await ownedTag(user, rawId);
  const obj = bodyObject(await jsonBody(req));
  let name: string | null = null;
  if (has(obj, "name")) name = await validateName(user, obj.name, tag.id);
  else if (!partial) throw ApiError.badRequest("name", REQUIRED);
  return row<TagRow>(
    sql`UPDATE api_tag SET name = COALESCE(${name}::varchar, name), last_modified = now() WHERE id = ${tag.id}
        RETURNING id, name, photo_count`,
  );
}

async function deleteIn(tx: Exec, tagId: number) {
  await tagsDeleted(tx, [tagId]);
  await rows(sql`DELETE FROM api_tag_photos WHERE tag_id = ${tagId}`, tx);
  await rows(sql`DELETE FROM api_tag WHERE id = ${tagId}`, tx);
}

/** DELETE /api/tags/{id}/ */
export async function remove(user: User, rawId: string) {
  const tag = await ownedTag(user, rawId);
  await db.transaction((tx) => deleteIn(tx, tag.id));
  return new Response(null, { status: 204 });
}

const rawError = (message: string) => json({ error: message }, 400);

/** _resolve_photos: undefined when no photos were given. */
async function resolvePhotos(user: User, body: unknown): Promise<PhotoSelection | undefined> {
  const obj = bodyObject(body);
  if (pyTruthy(obj.select_all)) {
    const query = obj.query && typeof obj.query === "object" && !Array.isArray(obj.query) ? (obj.query as Record<string, unknown>) : {};
    const excluded = Array.isArray(obj.excluded_hashes) ? obj.excluded_hashes.map(pyStr) : [];
    return { kind: "all", ownerId: user.id, favoriteMinRating: user.favoriteMinRating, params: photoFiltersFromJson(query), excludedHashes: excluded };
  }
  if (!Array.isArray(obj.photos) || !obj.photos.length) return undefined;
  const ids: string[] = [];
  const hashes: string[] = [];
  for (const v of obj.photos) {
    const r = photoRef(pyStr(v));
    if ("id" in r) ids.push(r.id);
    else hashes.push(r.hash);
  }
  const found = await rows<{ id: string; image_hash: string }>(
    sql`SELECT id, image_hash FROM api_photo WHERE owner_id = ${user.id}
        AND (id = ANY(${pgArray(ids, "uuid")}) OR image_hash = ANY(${pgArray(hashes, "text")}))`,
  );
  const fids = new Set(found.map((f) => f.id));
  const fhashes = new Set(found.map((f) => f.image_hash));
  if (!ids.every((id) => fids.has(id)) || !hashes.every((h) => fhashes.has(h))) throw ApiError.notFound("Unknown photo");
  return { kind: "ids", ids: found.map((f) => f.id) };
}

/** The post_add / post_remove receivers: visible-photo count and the sync bump. */
const afterLinkChange = (tx: Exec, tagId: number) =>
  row<TagRow>(
    sql`UPDATE api_tag AS t SET photo_count = (SELECT count(*) FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id
          WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), last_modified = now()
        WHERE t.id = ${tagId} RETURNING id, name, photo_count`,
    tx,
  );

const current = (tx: Exec, tagId: number) => row<TagRow>(sql`SELECT id, name, photo_count FROM api_tag WHERE id = ${tagId}`, tx);

/** Number of photos in the selection (the receivers only run for a non-empty one). */
async function selectionLen(tx: Exec, sel: PhotoSelection): Promise<number> {
  if (sel.kind === "ids") return sel.ids.length;
  return (await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${selectionIds(sel)}) sel`, tx))!.n;
}

async function changeLinks(user: User, rawId: string, req: Request, add: boolean) {
  const tag = await ownedTag(user, rawId);
  const sel = await resolvePhotos(user, await jsonBody(req));
  if (!sel) return rawError("No photos provided");
  return db.transaction(async (tx) => {
    const n = await selectionLen(tx, sel);
    if (n === 0) return current(tx, tag.id);
    if (add)
      await rows(
        sql`INSERT INTO api_tag_photos (tag_id, photo_id) SELECT ${tag.id}::int, sel.id FROM (${selectionIds(sel)}) sel ON CONFLICT DO NOTHING`,
        tx,
      );
    else await rows(sql`DELETE FROM api_tag_photos WHERE tag_id = ${tag.id} AND photo_id IN (${selectionIds(sel)})`, tx);
    return afterLinkChange(tx, tag.id);
  });
}

/** POST /api/tags/{id}/add/ */
export const addPhotos = (user: User, rawId: string, req: Request) => changeLinks(user, rawId, req, true);
/** POST /api/tags/{id}/remove/ */
export const removePhotos = (user: User, rawId: string, req: Request) => changeLinks(user, rawId, req, false);

/** POST /api/tags/{id}/merge/ {tag: <source id>}: source's photos move to the target, source goes. */
export async function merge(user: User, rawId: string, req: Request) {
  const tag = await ownedTag(user, rawId);
  const obj = bodyObject(await jsonBody(req));
  if (obj.tag === undefined || obj.tag === null) return rawError("No tag provided");
  const sourceId = pyInt(obj.tag);
  const source = isI32(sourceId) ? await ownedById(sourceId, user.id) : undefined;
  if (!source) return new Response(null, { status: 404 });
  if (source.id === tag.id) return rawError("A tag cannot be merged into itself");
  return db.transaction(async (tx) => {
    await rows(
      sql`INSERT INTO api_tag_photos (tag_id, photo_id) SELECT ${tag.id}::int, photo_id FROM api_tag_photos WHERE tag_id = ${source.id}
          ON CONFLICT DO NOTHING`,
      tx,
    );
    const had = await row<{ h: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM api_tag_photos WHERE tag_id = ${source.id}) AS h`, tx);
    const out = had!.h ? await afterLinkChange(tx, tag.id) : await current(tx, tag.id);
    await deleteIn(tx, source.id);
    return out;
  });
}
