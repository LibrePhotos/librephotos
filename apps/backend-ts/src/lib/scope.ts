// Authorization scopes (plans/rust-backend/02 §4, port of lp_db::scope):
// named SQL fragments, each ported from one Django concept. Never inline
// these conditions in area code.
//
// Every function returns ONE parenthesized boolean SQL expression over the
// photo table alias you pass (usually "p" for `api_photo p`). Combine with
// sql.join([...], sql` AND `) or interpolate into a drizzle sql template:
//
//   await rows(sql`SELECT p.id FROM api_photo p
//     WHERE ${ownedBy("p", user.id)} AND ${visibleManager("p")}`);
import { sql, type SQL } from "drizzle-orm";
import { ApiError } from "./errors";
import { pyTruthy, type QueryMap } from "./query";

const a = (alias: string) => sql.raw(alias);

/** PhotoQuerySet.owned_by(user): owner_id = user. */
export const ownedBy = (p: string, userId: number): SQL => sql`(${a(p)}.owner_id = ${userId})`;

/**
 * PhotoQuerySet.visible_to(user): public, or owned, or shared directly.
 * EXISTS, not a join: api_photo_shared_to must not duplicate rows.
 * null = anonymous (public only).
 */
export function visibleTo(p: string, userId: number | null): SQL {
  if (userId === null) return sql`(${a(p)}.public)`;
  return sql`(${a(p)}.public OR ${a(p)}.owner_id = ${userId} OR EXISTS (SELECT 1 FROM api_photo_shared_to st WHERE st.photo_id = ${a(p)}.id AND st.user_id = ${userId}))`;
}

/**
 * Q(owner=user) | Q(shared_to=user) over any model with an owner and a
 * shared_to M2M (mobile sync scope). Public rows are not included.
 */
export const ownedOrShared = (al: string, through: string, fk: string, userId: number): SQL =>
  sql`(${a(al)}.owner_id = ${userId} OR EXISTS (SELECT 1 FROM ${sql.raw(through)} sx WHERE sx.${sql.raw(fk)} = ${a(al)}.id AND sx.user_id = ${userId}))`;

/** thumbnail__aspect_ratio__isnull=False */
export const hasThumbnail = (p: string): SQL =>
  sql.raw(`EXISTS (SELECT 1 FROM api_thumbnail th WHERE th.photo_id = ${p}.id AND th.aspect_ratio IS NOT NULL)`);

/** Photo.visible manager: not hidden/trashed/removed and processed. */
export const visibleManager = (p: string): SQL =>
  sql`(NOT ${a(p)}.hidden AND NOT ${a(p)}.in_trashcan AND NOT ${a(p)}.removed AND ${hasThumbnail(p)})`;

/** Q(stacks__isnull=True) | Q(primary_in_stack__isnull=False) */
export const stackVisible = (p: string): SQL =>
  sql.raw(
    `(NOT EXISTS (SELECT 1 FROM api_photo_stacks sx WHERE sx.photo_id = ${p}.id) OR EXISTS (SELECT 1 FROM api_photostack sp WHERE sp.primary_photo_id = ${p}.id))`,
  );

/** faces__person__id = person */
export const personScope = (p: string, personId: number): SQL =>
  sql`EXISTS (SELECT 1 FROM api_face fx WHERE fx.photo_id = ${a(p)}.id AND fx.person_id = ${personId})`;

/** tags__id = tag */
export const tagScope = (p: string, tagId: number): SQL =>
  sql`EXISTS (SELECT 1 FROM api_tag_photos tx WHERE tx.photo_id = ${a(p)}.id AND tx.tag_id = ${tagId})`;

/** Django's prep_for_like_query: escape \ % _ (always write LIKE .. ESCAPE '\'). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Port of api.util.folder_path_prefixes. */
export function folderPathPrefixes(folder: string): string[] {
  const stripped = folder.replace(/[/\\]+$/, "");
  const windows = /^[A-Za-z]:([\\/]|$)/.test(folder) || folder.startsWith("\\\\");
  if (windows || (stripped.includes("\\") && !stripped.startsWith("/"))) return [`${stripped}\\`, `${stripped}/`];
  return [`${stripped}/`];
}

/** folder_path_q("files__path", folder): any of the photo's files lies inside folder. */
export function folderScope(p: string, folder: string): SQL {
  const likes = folderPathPrefixes(folder).map((pre) => sql`fx.path LIKE ${likeEscape(pre) + "%"} ESCAPE '\\'`);
  return sql`EXISTS (SELECT 1 FROM api_photo_files pfx JOIN api_file fx ON fx.hash = pfx.file_id WHERE pfx.photo_id = ${a(p)}.id AND (${sql.join(likes, sql` OR `)}))`;
}

/** Parameters of build_photo_queryset (api/views/photo_filters.py). */
export interface PhotoFilterParams {
  favorite: boolean;
  public: boolean;
  hidden: boolean;
  inTrashcan: boolean;
  video: boolean;
  photo: boolean;
  isScreenshot: boolean;
  isDocument: boolean;
  person?: number;
  tag?: number;
  folder?: string;
  showAllStackPhotos: boolean;
}

function parseId(field: string, raw: string): number {
  const t = raw.trim();
  if (!/^[+-]?\d+$/.test(t)) throw ApiError.badRequest(field, `Field '${field}' expected a number but got '${raw}'.`);
  return Number(t);
}

export function photoFiltersFromQuery(q: QueryMap): PhotoFilterParams {
  const person = q.nonEmpty("person");
  const tag = q.nonEmpty("tag");
  return {
    favorite: q.flag("favorite"),
    public: q.flag("public"),
    hidden: q.flag("hidden"),
    inTrashcan: q.flag("in_trashcan"),
    video: q.flag("video"),
    photo: q.flag("photo"),
    isScreenshot: q.flag("is_screenshot"),
    isDocument: q.flag("is_document"),
    person: person === undefined ? undefined : parseId("person", person),
    tag: tag === undefined ? undefined : parseId("tag", tag),
    folder: q.nonEmpty("folder"),
    showAllStackPhotos: q.flag("show_all_stack_photos"),
  };
}

/** From the `query` object of a select-all bulk request body. */
export function photoFiltersFromJson(v: Record<string, unknown>): PhotoFilterParams {
  const get = (k: string) => (pyTruthy(v?.[k]) ? v[k] : undefined);
  const id = (k: string) => {
    const x = get(k);
    if (x === undefined) return undefined;
    if (typeof x === "number" && Number.isInteger(x)) return x;
    if (typeof x === "string") return parseId(k, x);
    throw ApiError.badRequest(k, "expected an integer");
  };
  const folder = get("folder");
  return {
    favorite: get("favorite") !== undefined,
    public: get("public") !== undefined,
    hidden: get("hidden") !== undefined,
    inTrashcan: get("in_trashcan") !== undefined,
    video: get("video") !== undefined,
    photo: get("photo") !== undefined,
    isScreenshot: get("is_screenshot") !== undefined,
    isDocument: get("is_document") !== undefined,
    person: id("person"),
    tag: id("tag"),
    folder: typeof folder === "string" ? folder : undefined,
    showAllStackPhotos: get("show_all_stack_photos") !== undefined,
  };
}

/**
 * build_photo_queryset(user, params): the user's OWN photos matching a
 * select-all query (always owner-scoped; nothing in params can widen it).
 */
export function photoFilters(p: string, userId: number, favoriteMinRating: number, f: PhotoFilterParams): SQL {
  const P = a(p);
  const parts: SQL[] = [ownedBy(p, userId), hasThumbnail(p)];
  if (f.favorite) parts.push(sql`${P}.rating >= ${favoriteMinRating}`);
  if (f.public) parts.push(sql`${P}.public`);
  parts.push(sql`${P}.hidden = ${f.hidden}`);
  if (f.video) parts.push(sql`${P}.video`);
  else if (f.photo) parts.push(sql`NOT ${P}.video`);
  if (f.isScreenshot) parts.push(sql`${P}.is_screenshot`);
  if (f.isDocument) parts.push(sql`${P}.is_document`);
  parts.push(f.inTrashcan ? sql`${P}.in_trashcan AND NOT ${P}.removed` : sql`NOT ${P}.in_trashcan`);
  if (f.person !== undefined) parts.push(personScope(p, f.person));
  if (f.tag !== undefined) parts.push(tagScope(p, f.tag));
  if (f.folder !== undefined) parts.push(folderScope(p, f.folder));
  if (!f.showAllStackPhotos) parts.push(stackVisible(p));
  return sql`(${sql.join(parts, sql` AND `)})`;
}

/**
 * Everything the media views' grant order needs about one photo and one
 * requester (port of api/views/media.py). An album share vouches ONLY for
 * the album owner's photos (GHSA-phvg-g65q-rhq3).
 */
export interface PhotoGrants {
  is_owner: boolean;
  shared_directly: boolean;
  album_shared_to_user: boolean;
  in_public_album: boolean;
  is_public_photo: boolean;
}

export const mayAccess = (g: PhotoGrants) => g.is_owner || g.shared_directly || g.album_shared_to_user || g.in_public_album;

/** The PhotoGrants columns for photo alias p and requester userId (null = anonymous). */
export function photoGrantsSelect(p: string, userId: number | null): SQL {
  const P = a(p);
  const u = userId === null ? sql`NULL::int` : sql`${userId}::int`;
  return sql`COALESCE(${P}.owner_id = ${u}, FALSE) AS is_owner,
    (${u} IS NOT NULL AND EXISTS (SELECT 1 FROM api_photo_shared_to st WHERE st.photo_id = ${P}.id AND st.user_id = ${u})) AS shared_directly,
    (${u} IS NOT NULL AND EXISTS (SELECT 1 FROM api_albumuser_photos ap JOIN api_albumuser a ON a.id = ap.albumuser_id
       JOIN api_albumuser_shared_to ast ON ast.albumuser_id = a.id
       WHERE ap.photo_id = ${P}.id AND a.owner_id = ${P}.owner_id AND ast.user_id = ${u})) AS album_shared_to_user,
    EXISTS (SELECT 1 FROM api_albumuser_photos ap JOIN api_albumuser a ON a.id = ap.albumuser_id
       JOIN api_albumusershare s ON s.album_id = a.id
       WHERE ap.photo_id = ${P}.id AND a.owner_id = ${P}.owner_id AND s.enabled
         AND (s.expires_at IS NULL OR s.expires_at >= now())) AS in_public_album,
    (${P}.public AND NOT ${P}.hidden AND NOT ${P}.in_trashcan AND NOT ${P}.removed AND ${hasThumbnail(p)}) AS is_public_photo`;
}
