// The sync cursor token and the Python parsing rules the Django views apply
// to query parameters (port of lp_api::sync::cursor).
//
// A cursor is urlsafe_b64encode(f"{last_modified.isoformat()}|{pk}").
// Decoding follows decode_cursor: lenient base64 (binascii.a2b_base64,
// non-strict), strict UTF-8, split on the first `|`, then
// datetime.fromisoformat (CPython 3.11). Datetimes are kept as integer
// microseconds since the epoch: Django compares them at microsecond precision.

/** encode_cursor(last_modified, pk), from the isoformat() text of last_modified. */
export function encodeCursor(isoLastModified: string, pk: string): string {
  return Buffer.from(`${isoLastModified}|${pk}`, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

/** The datetime half of a decoded cursor: aware (UTC epoch micros) or naive (Django raises TypeError, a 500). */
export type CursorTime = { aware: true; micros: bigint } | { aware: false };

/** decode_cursor: null where Django answers 400 invalid_cursor. */
export function decodeCursor(cursor: string): { time: CursorTime; pk: string } | null {
  const translated = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = a2bBase64(translated);
  if (!bytes) return null;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const i = raw.indexOf("|");
  if (i < 0) return null;
  const time = fromisoformat(raw.slice(0, i));
  if (!time) return null;
  return { time, pk: raw.slice(i + 1) };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * CPython binascii.a2b_base64(data, strict_mode=False): characters outside
 * the alphabet are skipped, a complete pad sequence ends the input, and a
 * dangling quad is an error.
 */
function a2bBase64(data: string): Uint8Array | null {
  const out: number[] = [];
  let quadPos = 0;
  let left = 0;
  let pads = 0;
  for (let k = 0; k < data.length; k++) {
    const c = data.charCodeAt(k);
    if (c === 61 /* = */) {
      if (quadPos >= 2) {
        pads++;
        if (quadPos + pads >= 4) return Uint8Array.from(out);
      }
      continue;
    }
    const v = c < 128 ? B64.indexOf(data[k]) : -1;
    if (v < 0) continue;
    pads = 0;
    if (quadPos === 0) {
      quadPos = 1;
      left = v;
    } else if (quadPos === 1) {
      quadPos = 2;
      out.push(((left << 2) | (v >> 4)) & 0xff);
      left = v & 0x0f;
    } else if (quadPos === 2) {
      quadPos = 3;
      out.push(((left << 4) | (v >> 2)) & 0xff);
      left = v & 0x03;
    } else {
      quadPos = 0;
      out.push(((left << 6) | v) & 0xff);
      left = 0;
    }
  }
  return quadPos === 0 ? Uint8Array.from(out) : null;
}

/** n ASCII digits at the start of s, or null. */
function digits(s: string, n: number): number | null {
  if (s.length < n) return null;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    v = v * 10 + (c - 48);
  }
  return v;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's days_from_civil). */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * datetime.fromisoformat (CPython 3.11) for calendar dates: YYYY-MM-DD or
 * YYYYMMDD, then optionally any one separator character and a time
 * HH[:MM[:SS[.f+]]] (or basic HHMM[SS[.f+]], `,` also separates the
 * fraction; digits past the sixth are dropped) with an optional offset Z /
 * ±HH[:MM[:SS[.f]]] / ±HHMM. ISO week dates are not accepted.
 */
export function fromisoformat(s: string): CursorTime | null {
  let y: number | null, mo: number | null, d: number | null, rest: string;
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") {
    [y, mo, d] = [digits(s, 4), digits(s.slice(5), 2), digits(s.slice(8), 2)];
    rest = s.slice(10);
  } else if (s.length >= 8 && /^\d{8}/.test(s)) {
    [y, mo, d] = [digits(s, 4), digits(s.slice(4), 2), digits(s.slice(6), 2)];
    rest = s.slice(8);
  } else return null;
  if (y === null || mo === null || d === null || y === 0 || mo < 1 || mo > 12) return null;
  if (d < 1 || d > (mo === 2 && isLeap(y) ? 29 : DAYS[mo - 1])) return null;
  if (!rest) return { aware: false };
  // One separator character (any), then the time.
  const sep = rest.codePointAt(0)!;
  const t = parseTime(rest.slice(sep > 0xffff ? 2 : 1));
  if (!t) return null;
  if (t.offsetSecs === null) return { aware: false };
  const secs = BigInt(daysFromCivil(y, mo, d)) * 86400n + BigInt(t.h * 3600 + t.m * 60 + t.s) - BigInt(t.offsetSecs);
  return { aware: true, micros: secs * 1_000_000n + BigInt(t.us) };
}

/** HH[:MM[:SS[.ffffff]]] + offset, as _parse_isoformat_time. */
function parseTime(s: string): { h: number; m: number; s: number; us: number; offsetSecs: number | null } | null {
  const tzAt = s.search(/[+\-Z]/);
  const timeS = tzAt < 0 ? s : s.slice(0, tzAt);
  const tzS = tzAt < 0 ? null : s.slice(tzAt);
  const hms = parseHms(timeS);
  if (!hms) return null;
  const [h, m, sec, us] = hms;
  if (h > 23 || m > 59 || sec > 59) return null;
  let offsetSecs: number | null = null;
  if (tzS !== null) {
    if (tzS === "Z") offsetSecs = 0;
    else {
      const sign = tzS[0] === "-" ? -1 : 1;
      const body = tzS.slice(1);
      if (!body) return null;
      const o = parseHms(body);
      if (!o) return null;
      const [oh, om, os, ous] = o;
      if (oh >= 24) return null;
      // A fractional-second offset cannot be a FixedOffset.
      if (ous !== 0) return null;
      offsetSecs = sign * (oh * 3600 + om * 60 + os);
    }
  }
  return { h, m, s: sec, us, offsetSecs };
}

/** HH[:MM[:SS[(.|,)f+]]] or basic HH[MM[SS[(.|,)f+]]]. */
function parseHms(b: string): [number, number, number, number] | null {
  const extended = b.length > 2 && b[2] === ":";
  let pos = 0;
  const parts = [0, 0, 0];
  let n = 0;
  while (n < 3 && pos < b.length) {
    if (n > 0 && extended) {
      if (b[pos] !== ":") return null;
      pos++;
    }
    const v = digits(b.slice(pos), 2);
    if (v === null) return null;
    parts[n] = v;
    pos += 2;
    n++;
    if (pos < b.length && (b[pos] === "." || b[pos] === ",")) break;
  }
  if (n === 0) return null;
  let us = 0;
  if (pos < b.length) {
    if (!(b[pos] === "." || b[pos] === ",") || n < 3) return null;
    const frac = b.slice(pos + 1);
    if (!frac || !/^\d+$/.test(frac)) return null;
    us = Number(frac.slice(0, 6).padEnd(6, "0"));
  }
  return [parts[0], parts[1], parts[2], us];
}

/** UTC epoch micros as Python's isoformat() text ("...+00:00"), for SQL parameters. */
export function microsToIso(micros: bigint): string {
  const ms = micros / 1000n - (micros % 1000n < 0n ? 1n : 0n);
  const d = new Date(Number(ms));
  const us = Number(((micros % 1_000_000n) + 1_000_000n) % 1_000_000n);
  const y = d.getUTCFullYear();
  const ys = y >= 0 && y <= 9999 ? String(y).padStart(4, "0") : String(y);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${ys}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${String(us).padStart(6, "0")}+00:00`;
}

/** Python int(text) for a str: whitespace, a sign, ASCII digits with single underscores between them. Values past i64 saturate. */
export function pyInt(text: string): bigint | null {
  const t = text.trim();
  if (!t) return null;
  const neg = t[0] === "-";
  const body = t[0] === "-" || t[0] === "+" ? t.slice(1) : t;
  if (!/^\d(_?\d)*$/.test(body)) return null;
  let v = BigInt(body.replace(/_/g, ""));
  if (neg) v = -v;
  const MAX = 9223372036854775807n;
  return v > MAX ? MAX : v < -MAX - 1n ? -MAX - 1n : v;
}

/** Python float(text) for a str: whitespace, underscores between digits, inf / infinity / nan in any case. */
export function pyFloat(text: string): number | null {
  const t = text.trim();
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "_" && !(/\d/.test(t[i - 1] ?? "") && /\d/.test(t[i + 1] ?? ""))) return null;
  }
  const u = t.replace(/_/g, "");
  const m = /^([+-]?)(?:(inf|infinity)|(nan)|((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?))$/i.exec(u);
  if (!m) return null;
  if (m[2]) return m[1] === "-" ? -Infinity : Infinity;
  if (m[3]) return NaN;
  return Number(m[1] + m[4]);
}

/**
 * Django's UUIDField.to_python(str): uuid.UUID(hex=value) (urn:/uuid:
 * prefixes and braces stripped, hyphens removed, 32 hex digits via int(x, 16)).
 * Hyphenated lowercase, or null where Django raises.
 */
export function pyUuid(value: string): string | null {
  let h = value.replace(/urn:/g, "").replace(/uuid:/g, "");
  h = h.replace(/^[{}]+|[{}]+$/g, "").replace(/-/g, "");
  if (h.length !== 32) return null;
  const t = h.trim();
  const body = t[0] === "+" ? t.slice(1) : t;
  if (!/^[0-9a-f](_?[0-9a-f])*$/i.test(body)) return null;
  const hex = BigInt("0x" + body.replace(/_/g, ""))
    .toString(16)
    .padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
