// Shared pieces of the albums_tags area (port of lp_api::albums_tags::{dto,
// validate} and lp_db::albums_tags::{mod, things_places}): search terms,
// one-statement paging, DRF field validation, the grouped album photo lists.
import { sql, type SQL } from "drizzle-orm";
import { db, pgArray, rows, type Db, type Tx } from "~/lib/db";
import { ApiError, type FieldError } from "~/lib/errors";
import { groupByDate, pigColumns, PIG_JOINS, type DateGroup, type PigRow } from "~/lib/pig";
import { pageRequest, validFor, type PageRequest } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { likeEscape, photoFilters, visibleManager, type PhotoFilterParams } from "~/lib/scope";

export type Exec = Db | Tx;

// ------------------------------------------------------------- search

/** DRF SearchFilter terms: commas count as whitespace, quotes group words. */
export function searchTerms(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const text = raw.replaceAll("\0", "").replaceAll(",", " ");
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const c of text) {
    if (quote !== null) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/u.test(c)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** ` AND (e1 ILIKE %t% OR ...)` per term (Django icontains). */
export function searchSql(exprs: string[], terms: string[]): SQL {
  if (!terms.length) return sql``;
  return sql.join(
    terms.map((t) => {
      const pat = `%${likeEscape(t)}%`;
      return sql` AND (${sql.join(
        exprs.map((e) => sql`${sql.raw(e)} ILIKE ${pat}`),
        sql` OR `,
      )})`;
    }),
    sql``,
  );
}

// ------------------------------------------------------------- paging

export interface Paged<T> {
  rows: T[];
  total: number;
}

/** DRF page request with Django's default page_size param. */
export const pageReq = (q: QueryMap, def = 1000, max = 2000) => pageRequest(q, "page_size", def, max);

/**
 * One page with the total from `count(*) OVER () AS total_count` in the same
 * statement; an empty page past the start counts once more. Port of
 * fetch_page + fetch_paged.
 */
export async function fetchPage<T extends { total_count?: number | string | null }>(
  req: PageRequest,
  build: (limit: number, offset: number) => SQL,
  tx: Exec = db,
): Promise<{ req: PageRequest; paged: Paged<T> }> {
  const fetch = async (limit: number, offset: number): Promise<Paged<T>> => {
    const rs = await rows<T>(build(limit, offset), tx);
    if (rs.length) return { rows: rs, total: Number(rs[0].total_count ?? rs.length) };
    if (offset > 0) {
      const first = await rows<T>(build(1, 0), tx);
      return { rows: rs, total: first.length ? Number(first[0].total_count ?? 0) : 0 };
    }
    return { rows: rs, total: 0 };
  };
  if (req.page === Infinity) {
    const probe = await fetch(1, 0);
    req = validFor(req, probe.total);
  }
  const offset = (req.page - 1) * req.pageSize;
  if (!Number.isSafeInteger(offset)) throw ApiError.notFound("Invalid page.");
  const paged = await fetch(req.pageSize, offset);
  return { req: validFor(req, paged.total), paged };
}

// --------------------------------------------------- grouped album photos

export type MediaFilter = "all" | "videos" | "photos";

/** filter_photos_by_media_type: `video` wins over `photo`. */
export const mediaFilter = (q: QueryMap): MediaFilter => (q.flag("video") ? "videos" : q.flag("photo") ? "photos" : "all");

export const mediaSql = (m: MediaFilter): SQL =>
  m === "videos" ? sql` AND p.video` : m === "photos" ? sql` AND NOT p.video` : sql``;

export type AlbumSource =
  | { kind: "user"; id: number; public: boolean }
  | { kind: "thing"; id: number }
  | { kind: "place"; id: number }
  | { kind: "tag"; id: number };

const LINKS = {
  user: ["api_albumuser_photos", "albumuser_id"],
  thing: ["api_albumthing_photos", "albumthing_id"],
  place: ["api_albumplace_photos", "albumplace_id"],
  tag: ["api_tag_photos", "tag_id"],
} as const;

/** Members ordered by -exif_timestamp (NULLs first), ready for groupByDate. */
export function albumPhotoRows(src: AlbumSource, media: MediaFilter, tx: Exec = db): Promise<PigRow[]> {
  const [link, fk] = LINKS[src.kind];
  let rule: SQL = sql``;
  if (src.kind === "user") rule = src.public ? sql` AND NOT p.hidden AND NOT p.in_trashcan` : sql``;
  else if (src.kind === "place") rule = sql` AND NOT p.hidden`;
  else rule = sql` AND ${visibleManager("p")}`;
  return rows<PigRow>(
    sql`SELECT ${pigColumns()} FROM api_photo p${PIG_JOINS}
        WHERE p.id IN (SELECT l.photo_id FROM ${sql.raw(link)} l WHERE l.${sql.raw(fk)} = ${src.id})${rule}${mediaSql(media)}
        ORDER BY p.exif_timestamp DESC, p.id`,
    tx,
  );
}

/** GroupedPhotosSerializer groups ({date, location, items}). */
export const grouped = (rs: PigRow[]): DateGroup[] => groupByDate(rs);

// --------------------------------------------------- photo selections

/** Photos a bulk request names: owner-validated ids, or a select-all query. */
export type PhotoSelection =
  | { kind: "ids"; ids: string[] }
  | { kind: "all"; ownerId: number; favoriteMinRating: number; params: PhotoFilterParams; excludedHashes: string[] };

/** `SELECT <id> ...` of the selection (one column, any name). */
export function selectionIds(sel: PhotoSelection): SQL {
  if (sel.kind === "ids") return sql`SELECT sel.id FROM unnest(${pgArray(sel.ids, "uuid")}) AS sel(id)`;
  const excl = sel.excludedHashes.length ? sql` AND NOT (p.image_hash = ANY(${pgArray(sel.excludedHashes, "text")}))` : sql``;
  return sql`SELECT p.id FROM api_photo p WHERE ${photoFilters("p", sel.ownerId, sel.favoriteMinRating, sel.params)}${excl}`;
}

// --------------------------------------------------- DRF field validation

export const REQUIRED = "This field is required.";
export const NULL_MSG = "This field may not be null.";

/** Errors of one serializer, in field order. */
export class Errors {
  list: FieldError[] = [];
  add(field: string, message: string) {
    this.list.push({ field, message });
  }
  check<T>(field: string, r: Result<T>): T | undefined {
    if (r.ok) return r.value;
    this.add(field, r.error);
    return undefined;
  }
  throwIfAny() {
    if (this.list.length) throw ApiError.fields(400, this.list);
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T = never>(error: string): Result<T> => ({ ok: false, error });

/** Python type(x).__name__ of a JSON value. */
export function pyType(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** Python str(x) of a JSON scalar. */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function bodyObject(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw ApiError.validation(`Invalid data. Expected a dictionary, but got ${pyType(v)}.`);
  return v as Record<string, unknown>;
}

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export { has };

/** CharField(max_length) with trim_whitespace and no blanks. */
export function charField(v: unknown, maxLength: number): Result<string> {
  let text: string;
  if (v === null) return err(NULL_MSG);
  if (typeof v === "string") text = v;
  else if (typeof v === "number") text = String(v);
  else return pyStr(v).trim() === "" ? err("This field may not be blank.") : err("Not a valid string.");
  const t = text.trim();
  if (!t) return err("This field may not be blank.");
  if ([...t].length > maxLength) return err(`Ensure this field has no more than ${maxLength} characters.`);
  return ok(t);
}

const TRUE = new Set(["t", "T", "y", "Y", "yes", "Yes", "YES", "true", "True", "TRUE", "on", "On", "ON", "1"]);
const FALSE = new Set(["f", "F", "n", "N", "no", "No", "NO", "false", "False", "FALSE", "off", "Off", "OFF", "0"]);

export function boolField(v: unknown): Result<boolean> {
  if (v === null) return err(NULL_MSG);
  if (typeof v === "boolean") return ok(v);
  if (typeof v === "number") return v === 1 ? ok(true) : v === 0 ? ok(false) : err("Must be a valid boolean.");
  if (typeof v === "string") return TRUE.has(v) ? ok(true) : FALSE.has(v) ? ok(false) : err("Must be a valid boolean.");
  return err("Must be a valid boolean.");
}

/** ListField(child=CharField(max_length)). */
export function stringList(v: unknown, maxLength: number): Result<string[]> {
  if (v === null) return err(NULL_MSG);
  if (!Array.isArray(v)) return err(`Expected a list of items but got type "${pyType(v)}".`);
  const out: string[] = [];
  const bad: string[] = [];
  v.forEach((item, i) => {
    const r = charField(item, maxLength);
    if (r.ok) out.push(r.value);
    else {
      const m = r.error;
      const code = m === NULL_MSG ? "null" : m.startsWith("This field may not be blank") ? "blank" : m.startsWith("Ensure") ? "max_length" : "invalid";
      bad.push(`${i}: [ErrorDetail(string='${m}', code='${code}')]`);
    }
  });
  return bad.length ? err(`{${bad.join(", ")}}`) : ok(out);
}

export function dictField(v: unknown): Result<Record<string, unknown>> {
  if (v === null) return err(NULL_MSG);
  if (typeof v === "object" && !Array.isArray(v)) return ok(v as Record<string, unknown>);
  return err(`Expected a dictionary of items but got type "${pyType(v)}".`);
}

/** Django UUIDField.to_python on a request value: the dashed lowercase uuid. */
export function pyUuid(v: unknown): Result<string> {
  const invalid = () => err<string>(`“${pyStr(v)}” is not a valid UUID.`);
  let hex: string;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) return invalid();
    hex = v.toString(16).padStart(32, "0");
  } else if (typeof v === "string") {
    hex = v.replaceAll("urn:", "").replaceAll("uuid:", "").replace(/^[{}]+|[{}]+$/g, "").replaceAll("-", "");
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) return invalid();
  } else return invalid();
  hex = hex.toLowerCase();
  return ok(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}

/** One OwnedPhotoField value. */
export const photoPk = (v: unknown): Result<string> =>
  typeof v === "boolean" ? err("Incorrect type. Expected pk value, received bool.") : pyUuid(v);

export const doesNotExist = (v: unknown) => `Invalid pk "${pyStr(v)}" - object does not exist.`;

/** ManyRelatedField input items (a list; a dict iterates its keys). */
export function manyItems(v: unknown): Result<unknown[]> {
  if (v === null) return err(NULL_MSG);
  if (Array.isArray(v)) return ok(v);
  if (typeof v === "object") return ok(Object.keys(v as object));
  return err(`Expected a list of items but got type "${pyType(v)}".`);
}

/** Django IntegerField.get_prep_value (int(value)); undefined = Python raises. */
export function pyInt(v: unknown): number | undefined {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : undefined;
  if (typeof v === "string") {
    const t = v.trim();
    return /^[+-]?\d+$/.test(t) ? Number(t) : undefined;
  }
  return undefined;
}

export const isI32 = (n: number | undefined): n is number => n !== undefined && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

/** A path id DRF's get_object_or_404 would reject before querying: Not found. */
export function parsePk(raw: string): number {
  const t = raw.trim();
  const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  if (!isI32(n)) throw ApiError.notFound();
  return n;
}

/** The id as re.findall + filter(id=...) would use it; undefined matches nothing. */
export function lookupId(raw: string): number | undefined {
  const t = raw.trim();
  const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  return isI32(n) ? n : undefined;
}
