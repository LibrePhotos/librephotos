// Helpers shared by the timeline_photos and search_sharing_public areas
// (port of lp_db::timeline_photos::{PhotoLookup, media_url} and the
// PhotoMetadata display properties in lp_api::timeline_photos::metadata).
import { sql, type SQL } from "drizzle-orm";

/**
 * `_get_photo_filter_kwargs`: 36 chars with four hyphens whose 32 remaining
 * chars are hex look up `pk`, anything else `image_hash` (Python drops the
 * hyphens wherever they sit).
 */
export type PhotoLookup = { kind: "id"; id: string } | { kind: "hash"; hash: string };

export function parseLookup(raw: string): PhotoLookup {
  if ([...raw].length === 36 && raw.split("-").length === 5) {
    const hex = raw.replaceAll("-", "");
    if (/^[0-9a-fA-F]{32}$/.test(hex)) {
      const h = hex.toLowerCase();
      return { kind: "id", id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
    }
  }
  return { kind: "hash", hash: raw };
}

/** `(p.id = $x)` or `(p.image_hash = $x)`. */
export function lookupSql(l: PhotoLookup, p: string): SQL {
  return l.kind === "id" ? sql`(${sql.raw(p)}.id = ${l.id}::uuid)` : sql`(${sql.raw(p)}.image_hash = ${l.hash})`;
}

const SAFE = new Set(Array.from("/~!*()'-_.", (c) => c.charCodeAt(0)));

function quotePath(name: string): string {
  // encodeURIComponent keeps exactly alnum and -_.!~*'() (UTF-8, upper-case
  // hex), i.e. this SAFE set minus "/": the fast path for the usual names.
  try {
    return encodeURIComponent(name.replaceAll("\\", "/")).replaceAll("%2F", "/");
  } catch {
    // lone surrogates: fall through to the byte loop (TextEncoder's U+FFFD)
  }
  let out = "";
  for (const b of new TextEncoder().encode(name.replaceAll("\\", "/"))) {
    const alnum = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
    out += alnum || SAFE.has(b) ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Django `FieldFile.url` under `MEDIA_URL = "/media/"` (backslashes become slashes, URL-quoted). */
export const mediaUrl = (name: string) => "/media/" + quotePath(name);

/** `FieldFile.url`, or "" for an empty field. */
export const fileUrl = (name: string | null | undefined) => (name ? mediaUrl(name) : "");

/** Python `int(s)` for a query value (surrounding whitespace, one leading +/-). */
export function pyInt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) return undefined;
  return Number(t);
}

/** `camera_display` / `lens_display`: Python and/or on optional strings. */
export function displayName(make: string | null | undefined, model: string | null | undefined): string | null {
  if (make && model) return model.startsWith(make) ? model : `${make} ${model}`;
  if (model) return model;
  return make ?? null;
}

export function resolution(w: number | null | undefined, h: number | null | undefined): string | null {
  return w && h ? `${w}x${h}` : null;
}

/**
 * Python round(x, 1) for x >= 0: the exact binary value, ties to even
 * (toFixed breaks exact ties upwards instead).
 */
export function pyRound1(x: number): number {
  const exact = x.toFixed(20);
  const dot = exact.indexOf(".");
  if (exact.slice(dot + 2) === "5" + "0".repeat(19)) {
    const lastDigit = Number(exact[dot + 1]);
    const truncated = Number(exact.slice(0, dot + 2));
    return lastDigit % 2 === 0 ? truncated : Number((truncated + 0.1).toFixed(1));
  }
  return Number(x.toFixed(1));
}

export function megapixels(w: number | null | undefined, h: number | null | undefined): number | null {
  return w && h ? pyRound1((w * h) / 1_000_000) : null;
}

/** Python truthiness of a JSON value. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}
