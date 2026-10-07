// Python/DRF datetime string formats (port of lp_core::time).
//   drf:  DRF DateTimeField output, "2020-01-02T03:04:05.123456Z"
//   iso:  datetime.isoformat() on an aware UTC value, "...+00:00"
// Microseconds are printed only when non-zero, as Python does.
// Bun's driver turns timestamptz into a millisecond Date, so format in SQL:
//   sql`SELECT ${drfTs(sql`p.added_on`)} AS added_on ...`
import { sql, type SQL } from "drizzle-orm";

const BASE = `'YYYY-MM-DD"T"HH24:MI:SS'`;

function fmt(col: SQL | string, suffix: string): SQL {
  const c = typeof col === "string" ? sql.raw(col) : col;
  return sql`(CASE WHEN ${c} IS NULL THEN NULL ELSE to_char(${c} AT TIME ZONE 'UTC', ${sql.raw(BASE)}) || CASE WHEN extract(microseconds FROM ${c})::bigint % 1000000 <> 0 THEN to_char(${c} AT TIME ZONE 'UTC', '.US') ELSE '' END || ${suffix} END)`;
}

/** SQL expression: DRF DateTimeField text ("...Z") or NULL. */
export const drfTs = (col: SQL | string) => fmt(col, "Z");
/** SQL expression: Python isoformat() text ("...+00:00") or NULL. */
export const pyIsoTs = (col: SQL | string) => fmt(col, "+00:00");

function base(d: Date, micros = 0): string {
  const s = d.toISOString().slice(0, 19);
  const us = micros || d.getUTCMilliseconds() * 1000;
  return us ? `${s}.${String(us).padStart(6, "0")}` : s;
}
/** JS-side DRF format for Dates we created ourselves (ms precision). */
export const drfDate = (d: Date | null | undefined) => (d ? base(d) + "Z" : null);
export const pyIsoDate = (d: Date | null | undefined) => (d ? base(d) + "+00:00" : null);

/**
 * Parse what Django's DateTimeField accepts from clients: ISO 8601 with Z or
 * an offset, or naive (taken as UTC). Returns a Postgres-ready ISO string
 * (microseconds preserved) or null.
 */
export function parseClientDatetime(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (!m) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    return d ? `${t}T00:00:00+00:00` : null;
  }
  const [, y, mo, da, h, mi, se = "00", frac = "", tz] = m;
  let off = !tz || tz.toUpperCase() === "Z" ? "+00:00" : tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const iso = `${y}-${mo}-${da}T${h}:${mi}:${se}${frac ? "." + frac.padEnd(6, "0") : ""}${off}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
