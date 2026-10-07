// Shared helpers of the people_faces area (port of lp_api::people_faces mod.rs).
// The face views answer their own errors as {"status": false, "message"}
// bodies (not the DRF envelope), exactly like Django's Response(...)s.
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { pyTruthy } from "~/lib/query";

export const UNKNOWN_PERSON_NAME = "Unknown - Other";

/** {"status": false, "message": ...} with a status, as the face views answer. */
export const statusMessage = (status: number, message: string) => json({ status: false, message }, status);

/** FieldFile.url of a stored media name: /media/<quote(name, safe="/~!*()'")>. */
export function mediaUrl(name: string): string {
  return "/media/" + encodeURIComponent(name.replace(/\\/g, "/")).replace(/%2F/g, "/");
}

/** request.build_absolute_uri(path). */
export function absoluteUrl(req: Request, path: string): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const scheme = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${scheme}://${host}${path}`;
}

/** Python int() of a string (whitespace trimmed, `_` separators); null when invalid. */
export function pyInt(s: string): bigint | null {
  const t = s.trim().replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(t)) return null;
  return BigInt(t);
}

const INT4_MIN = -2147483648n;
const INT4_MAX = 2147483647n;
export const fitsInt4 = (n: bigint) => n >= INT4_MIN && n <= INT4_MAX;

/**
 * body["face_ids"] as in_bulk takes it (ints or numeric strings). Anything
 * else crashes the Django view, hence the 500.
 */
export function faceIds(body: unknown): number[] {
  const list = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).face_ids : undefined;
  if (!Array.isArray(list)) throw ApiError.internal("face_ids missing or not a list");
  return list.map((v) => {
    let n: bigint | null = null;
    if (typeof v === "number" && Number.isInteger(v)) n = BigInt(v);
    else if (typeof v === "string") n = pyInt(v);
    if (n === null || !fitsInt4(n)) throw ApiError.internal("face id is not an integer");
    return Number(n);
  });
}

/**
 * (request.data.get(key) or "").strip(); non-string truthy values crash the
 * Django view (.strip() on them), hence the 500.
 */
export function strippedStr(body: unknown, key: string): string {
  const v = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
  if (typeof v === "string") return v.trim();
  if (pyTruthy(v)) throw ApiError.internal(`${key} is not a string`);
  return "";
}

/** Python float(s) of a string; null when it does not parse. */
export function parsePyFloat(s: string): number | null {
  const t = s.trim().replace(/_/g, "").toLowerCase();
  const m = /^([+-]?)(inf|infinity|nan)$/.exec(t);
  if (m) return m[2] === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) return null;
  return Number(t);
}

/** float() of a query parameter; Django crashes (500) on anything it cannot parse. */
export function pyFloatParam(s: string): number {
  const v = parsePyFloat(s);
  if (v === null) throw ApiError.internal(`could not convert string to float: ${JSON.stringify(s)}`);
  return v;
}
