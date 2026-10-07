// How SetUserAlbumPublic reads `expires_at` (port of
// lp_api::albums_tags::validate::django_parse_datetime): Django's
// parse_datetime inside try/except. The result is a Postgres-ready
// timestamptz text.

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  frac: string;
  /** offset minutes east of UTC */
  off: number;
}

function valid(p: Parts): boolean {
  return (
    p.y >= 1 &&
    p.mo >= 1 &&
    p.mo <= 12 &&
    p.d >= 1 &&
    p.d <= daysIn(p.y, p.mo) &&
    p.h < 24 &&
    p.mi < 60 &&
    p.s < 60 &&
    Math.abs(p.off) < 24 * 60
  );
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function text(p: Parts): string {
  const sign = p.off < 0 ? "-" : "+";
  const a = Math.abs(p.off);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${p.frac.padEnd(6, "0").slice(0, 6)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function offset(tz: string | undefined): number {
  if (!tz || tz === "Z" || tz === "z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(tz)!;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** lp_core parse_client_datetime: RFC 3339 / ISO with offset, naive (UTC), or a date. */
function clientDatetime(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (m) {
    const p: Parts = {
      y: +m[1],
      mo: +m[2],
      d: +m[3],
      h: +m[4],
      mi: +m[5],
      s: +(m[6] ?? 0),
      frac: m[7] ?? "",
      off: offset(m[8]),
    };
    return valid(p) ? text(p) : null;
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (d) {
    const p: Parts = { y: +d[1], mo: +d[2], d: +d[3], h: 0, mi: 0, s: 0, frac: "", off: 0 };
    return valid(p) ? text(p) : null;
  }
  return null;
}

/**
 * `share.expires_at = parse_datetime(value)` inside `try/except: pass`:
 * a string or null is what Django stores (null for text it cannot read),
 * undefined keeps the old value (a well-formed but impossible date raises).
 */
export function djangoParseDatetime(s: string): string | null | undefined {
  const c = clientDatetime(s);
  if (c !== null) return c;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,6})\d{0,6})?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s);
  if (!m) return null;
  const p: Parts = {
    y: +m[1],
    mo: +m[2],
    d: +m[3],
    h: +m[4],
    mi: +m[5],
    s: +(m[6] ?? 0),
    frac: m[7] ?? "",
    off: offset(m[8]),
  };
  return valid(p) ? text(p) : undefined;
}
