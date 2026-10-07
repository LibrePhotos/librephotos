// Shared bits of the stats/admin/stacks/dupes area (port of
// lp_api::stats_admin_stacks_dupes::paging and lp_db's area helpers): the
// hand-rolled Django Paginator of the stacks and duplicates lists, body
// helpers, Python str()/int() of JSON values and thumbnail URLs.
import { ApiError } from "~/lib/errors";
import type { QueryMap } from "~/lib/query";

/** Python `int(s)` for a string (underscores between digits allowed). */
export function pyInt(s: string): number | undefined {
  const t = s.trim();
  const digits = t.replace(/^[+-]/, "");
  if (!digits || digits.startsWith("_") || digits.endsWith("_") || digits.includes("__")) return undefined;
  const c = t.replace(/_/g, "");
  return /^[+-]?\d+$/.test(c) ? Number(c) : undefined;
}

/** Python `int(value)` for a JSON body field. */
export function jsonInt(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return pyInt(v);
  return undefined;
}

/** Python `str()` of a JSON scalar. */
export function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/** `request.data.get(key)` on a JSON body (undefined unless the body is an object). */
export function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

/** `list(dict.fromkeys(value))` for `photo_hashes`: unique, in order. */
export function hashList(v: unknown): string[] {
  let items: string[] = [];
  if (Array.isArray(v)) items = v.map(pyStr);
  else if (typeof v === "string") items = [...v];
  else if (v && typeof v === "object") items = Object.keys(v);
  return [...new Set(items)];
}

const UUID_RE = /^(?:[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}|\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\})$/i;

/** A group id from the URL; anything but a UUID is a 404 like a missing group. */
export function parseId(raw: string, notFound: string): string {
  if (!UUID_RE.test(raw)) throw ApiError.notFound(notFound);
  const hex = raw.replace(/[{}-]/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Django's `Paginator.get_page` over `page` / `page_size` (default 20, max 100). */
export class Paging {
  readonly requested: number;
  readonly pageSize: number;
  constructor(q: QueryMap) {
    const page = q.get("page");
    const size = q.get("page_size");
    this.requested = Math.max(1, (page === undefined ? undefined : pyInt(page)) ?? 1);
    this.pageSize = Math.min(100, Math.max(1, (size === undefined ? undefined : pyInt(size)) ?? 20));
  }
  numPages(count: number) {
    return Math.ceil(Math.max(count, 1) / this.pageSize);
  }
  /** Past the end means the last page. */
  actual(count: number) {
    return Math.min(this.requested, this.numPages(count));
  }
  offset(count: number) {
    return (this.actual(count) - 1) * this.pageSize;
  }
  envelope<T>(count: number, results: T[]) {
    const actual = this.actual(count);
    const numPages = this.numPages(count);
    return {
      results,
      count,
      num_pages: numPages,
      page: this.requested,
      page_size: this.pageSize,
      has_next: actual < numPages,
      has_previous: actual > 1,
    };
  }
}

/** `api.models.Person.UNKNOWN_PERSON_NAME`. */
export const UNKNOWN_PERSON_NAME = "Unknown - Other";

/** `/media/square_thumbnails_small/<hash>` when the photo has that thumbnail. */
export const smallThumbnailUrl = (hash: string, small: string | null | undefined) =>
  small ? `/media/square_thumbnails_small/${hash}` : null;

/** `/media/thumbnails_big/<hash>` when the photo has that thumbnail. */
export const bigThumbnailUrl = (hash: string, big: string | null | undefined) => (big ? `/media/thumbnails_big/${hash}` : null);

/** `File.get_type_display()`. */
export function fileTypeDisplay(t: number): string {
  return ({ 1: "Image", 2: "Video", 3: "Metadata File e.g. XMP", 4: "Raw File", 5: "Unknown" } as Record<number, string>)[t] ?? String(t);
}

/**
 * Python's round(x, ndigits): rounds the exact binary value, ties to even.
 * toFixed also rounds the exact value but sends exact ties up, so ties are
 * found in a long expansion and settled here.
 */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x)) return x;
  const long = Math.abs(x).toFixed(Math.min(100, ndigits + 60));
  const dot = long.indexOf(".");
  const rest = long.slice(dot + 1 + ndigits);
  if (/^50*$/.test(rest)) {
    const kept = long.slice(0, dot + 1 + ndigits).replace(".", "");
    const last = Number(kept[kept.length - 1]);
    let n = BigInt(kept);
    if (last % 2 === 1) n += 1n;
    return (Math.sign(x) * Number(n)) / 10 ** ndigits;
  }
  return Number(x.toFixed(ndigits));
}
