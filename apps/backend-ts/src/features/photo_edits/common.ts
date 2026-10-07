// Shared request parsing for the photo_edits area (port of
// lp_api::photo_edits mod.rs): Django's value coercions, the bulk selection
// (image_hashes OR select_all + query + excluded_hashes) and the
// {"status": false, "message"} failure shape these views answer with.
import { sql, type SQL } from "drizzle-orm";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { pgArray, type Tx } from "~/lib/db";
import { pyTruthy } from "~/lib/query";
import { photoFilters, photoFiltersFromJson, type PhotoFilterParams } from "~/lib/scope";
import type { User } from "~/lib/users";

export type Body = Record<string, unknown>;

/** `{"status": false, "message": ...}` with a status (not the error envelope). */
export const statusMessage = (status: number, message: string) => json({ status: false, message }, status);

/** The body must be a JSON object (DRF `request.data` of a dict view). */
export function object(body: unknown): Body {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) return body as Body;
  throw ApiError.badRequest("non_field_errors", "Invalid data. Expected a dictionary.");
}

/** `request.data[key]`; a missing key is a 400 here (a KeyError 500 on Django). */
export function required(body: Body, key: string): unknown {
  if (!(key in body)) throw ApiError.badRequest(key, "This field is required.");
  return body[key];
}

/** Django's model BooleanField.to_python: no lowercase "true"/"false". */
export function modelBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v === "string") {
    if (v === "t" || v === "True" || v === "1") return true;
    if (v === "f" || v === "False" || v === "0") return false;
  }
  return undefined;
}

/** DRF serializers.BooleanField.to_internal_value (case-insensitive words). */
export function drfBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["t", "y", "yes", "true", "on", "1"].includes(s)) return true;
    if (["f", "n", "no", "false", "off", "0"].includes(s)) return false;
  }
  return undefined;
}

/** Python repr of a JSON number (`1.0`, `1e+16`...): what str(x) prints. */
function pyNum(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  return JSON.stringify(n);
}

/** `str(x)` of a value Django coerces for a lookup. */
export function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") return pyNum(v);
  return JSON.stringify(v);
}

function stringList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(pyStr);
  // Django iterates a string given where a list is expected (`__in`,
  // `dict.fromkeys`): it names one-character hashes, not itself.
  if (typeof v === "string") return [...v];
  throw ApiError.badRequest(field, "Expected a list of items.");
}

export type Selection =
  | { kind: "hashes"; hashes: string[] }
  | { kind: "all"; params: PhotoFilterParams; excluded: string[] };

/** `image_hashes`, or `select_all` + `query` (+ `excluded_hashes`). */
export function selection(body: Body, forceTrash: boolean): Selection {
  if (pyTruthy(body.select_all)) {
    const q = body.query === undefined || body.query === null ? {} : body.query;
    const params = photoFiltersFromJson(q as Record<string, unknown>);
    if (forceTrash) params.inTrashcan = true;
    return { kind: "all", params, excluded: stringList(body.excluded_hashes, "excluded_hashes") };
  }
  return { kind: "hashes", hashes: stringList(required(body, "image_hashes"), "image_hashes") };
}

/** build_photo_queryset(user, query) minus excluded_hashes, over alias p. */
export function selectAllWhere(user: User, params: PhotoFilterParams, excluded: string[]): SQL {
  const base = photoFilters("p", user.id, user.favoriteMinRating, params);
  if (!excluded.length) return base;
  return sql`${base} AND NOT (p.image_hash = ANY(${pgArray(excluded, "text")}))`;
}

export const metadataToDisk = (u: User) => u.saveMetadataToDisk !== "OFF";

/** Unique values in first-seen order. */
export const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** INSERT one untracked job per payload inside a drizzle transaction (lp_jobs::enqueue_many_in). */
export async function enqueueManyTx(tx: Tx, kind: string, payloads: unknown[]): Promise<void> {
  if (!payloads.length) return;
  await tx.execute(sql`INSERT INTO job_queue (kind, payload, run_after, max_attempts)
    SELECT ${kind}, p.value, now(), 1 FROM jsonb_array_elements(${JSON.stringify(payloads)}::text::jsonb) WITH ORDINALITY AS p(value, ord) ORDER BY p.ord`);
}
