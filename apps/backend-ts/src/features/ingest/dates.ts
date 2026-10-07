// api/date_time_extractor.py (port of lp-ingest dates.rs): the owner's
// datetime rules, applied in order until one yields a local time, stored
// labelled as UTC. Datetimes here are naive, as microseconds since the
// epoch read as UTC (`Micros`), so WhatsApp's sequence-number microseconds
// survive; toPgTimestamp() renders them for SQL.
import { statSync } from "node:fs";
import { geoTz } from "exiftool-vendored/dist/GeoTz";
import { truthy, valueStr, type PyValue } from "./pyfmt";
import { fileName } from "./fsutil";

export type Micros = number;

const groupRange = (a: number, b: number) => `(${Array.from({ length: b - a }, (_, i) => String(a + i).padStart(2, "0")).join("|")})`;

const REGEXP_NO_TZ = new RegExp(
  "(?<!\\d)" + ["((?:19|20|21)\\d\\d)", groupRange(1, 13), groupRange(1, 32), groupRange(0, 24), "([0-5]\\d)", "([0-5]\\d)"].join("[-:_\\., ]*"),
);
const REGEXP_WHATSAPP = /^(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})(?:[-_]WA(\d+))?/;
const WHATSAPP_MAPPING = ["year", "month", "day", "microsecond"];
const MAPPING_INDEX: Record<string, number> = { year: 0, month: 1, day: 2, hour: 3, minute: 4, second: 5, microsecond: 6 };

const regexCache = new Map<string, RegExp | null>();
/** A user-supplied Python pattern as a JS RegExp (named-group syntax translated), null when invalid. */
function pyRegex(pattern: string): RegExp | null {
  let r = regexCache.get(pattern);
  if (r === undefined) {
    try {
      r = new RegExp(pattern.replace(/\(\?P</g, "(?<").replace(/\(\?P=(\w+)\)/g, "\\k<$1>"));
    } catch {
      r = null;
    }
    regexCache.set(pattern, r);
  }
  return r;
}

const reSearch = (pattern: string, text: string) => pyRegex(pattern)?.test(text) ?? false;

/** datetime(*args) with Python's validation (microsecond < 1e6). */
function makeDatetime(a: (number | null)[]): Micros | null {
  if (a.some((x) => x === null)) return null;
  const [y, mo, d, h, mi, s, us] = a as number[];
  if (y < 1 || y > 9999 || us < 0 || us >= 1_000_000) return null;
  if (mo < 1 || mo > 12 || d < 1 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  dt.setUTCHours(h, mi, s, 0);
  return dt.getTime() * 1000 + us;
}

/** _extract_no_tz_datetime_from_str; throws for a bad group mapping (Django raises). */
function extractNoTz(x: string, regexp: RegExp, mapping: string[] | null): Micros | null {
  const m = regexp.exec(x);
  if (!m) return null;
  const groups = m.slice(1);
  const args: (number | null)[] = [null, null, null, 0, 0, 0, 0];
  const toInt = (g: string | undefined) => (g !== undefined && /^\s*[+-]?\d+\s*$/.test(g) ? Number.parseInt(g, 10) : null);
  if (!mapping) {
    if (groups.length < 3 || groups.length > 7) return null;
    for (let i = 0; i < groups.length; i++) {
      const v = toInt(groups[i]);
      if (v === null) return null;
      args[i] = v;
    }
  } else {
    if (groups.length > mapping.length) throw new Error(`Can't have more groups than group mapping values: ${x}`);
    groups.forEach((g, i) => {
      const ind = MAPPING_INDEX[mapping[i]];
      if (ind === undefined) throw new Error(`Group mapping ${mapping[i]} is unknown`);
      const v = toInt(g);
      if (v !== null) args[ind] = v;
    });
  }
  const parsed = makeDatetime(args);
  if (parsed === null) return null;
  // (parsed - datetime.now()).days > 30; this process runs in UTC like Django's containers.
  if (Math.floor((parsed - Date.now() * 1000) / 86_400e6) > 30) return null;
  return parsed;
}

// ---- time zones -------------------------------------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat | null>();
function tzFormat(tz: string): Intl.DateTimeFormat | null {
  let f = fmtCache.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", era: "short",
        year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      });
    } catch {
      f = null;
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** UTC offset of `tz` at the instant `ms`, in seconds. */
function offsetSecs(tz: string, ms: number): number {
  const parts = tzFormat(tz)!.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let year = get("year");
  if (parts.find((p) => p.type === "era")?.value === "BC") year = 1 - year;
  const d = new Date(0);
  d.setUTCFullYear(year, get("month") - 1, get("day"));
  d.setUTCHours(get("hour"), get("minute"), get("second"), 0);
  return Math.round((d.getTime() - (ms - (((ms % 1000) + 1000) % 1000))) / 1000);
}

/** pytz's default tzinfo of a zone is its first (LMT) entry, rounded to whole minutes. */
const lmtOffsetSecs = (tz: string) => Math.floor((offsetSecs(tz, Date.UTC(1800, 0, 1)) + 30) / 60) * 60;

type Zone = { kind: "utc" } | { kind: "local" } | { kind: "named"; tz: string };

const validTz = (tz: string) => (tz && tzFormat(tz) ? tz : null);

function gpsTz(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  try {
    return validTz(geoTz(lat, lon) ?? "");
  } catch {
    return null;
  }
}

export interface Inputs {
  gpsLat: number | null;
  gpsLon: number | null;
  userDefaultTz: string;
  userDefinedTimestamp: Micros | null;
}

export type Rule = Record<string, unknown>;

const s = (r: Rule, k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);

function zone(desc: string, ctx: Inputs): Zone | null {
  if (desc === "gps_timezonefinder") {
    const tz = gpsTz(ctx.gpsLat, ctx.gpsLon);
    return tz ? { kind: "named", tz } : null;
  }
  if (desc === "user_default") {
    const tz = validTz(ctx.userDefaultTz);
    return tz ? { kind: "named", tz } : null;
  }
  // server_local: this process (like Django's containers) runs in UTC.
  if (desc === "server_local") return { kind: "local" };
  if (desc.toLowerCase() === "utc") return { kind: "utc" };
  if (desc.startsWith("name:")) {
    const tz = validTz(desc.slice(5));
    return tz ? { kind: "named", tz } : null;
  }
  return null;
}

function transform(rule: Rule, dt: Micros | null, ctx: Inputs): Micros | null {
  if (dt === null) return null;
  if (!truthy(rule.transform_tz as PyValue)) return dt;
  const srcDesc = s(rule, "source_tz");
  const repDesc = s(rule, "report_tz");
  if (srcDesc === null || repDesc === null) return null;
  const source = zone(srcDesc, ctx);
  const report = zone(repDesc, ctx);
  if (!source || !report) return null;
  // dt.replace(tzinfo=source).timestamp(): pytz zones attach their LMT offset.
  const utc = source.kind === "named" ? dt - lmtOffsetSecs(source.tz) * 1e6 : dt;
  if (report.kind !== "named") return utc;
  return utc + offsetSecs(report.tz, Math.floor(utc / 1000)) * 1e6;
}

export function requiredTags(rules: Rule[]): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  for (const r of rules) {
    const cond = s(r, "condition_exif");
    if (cond?.includes("//")) add(cond.slice(0, cond.indexOf("//")));
    if (s(r, "rule_type") === "exif" && s(r, "exif_tag")) add(s(r, "exif_tag")!);
  }
  return out;
}

function checkConditions(r: Rule, p: string, exif: Map<string, PyValue | null>): boolean {
  const cond = s(r, "condition_exif");
  if (cond?.includes("//")) {
    const i = cond.indexOf("//");
    const v = exif.get(cond.slice(0, i));
    if (v == null || !truthy(v) || !reSearch(cond.slice(i + 2), valueStr(v))) return false;
  }
  const cp = s(r, "condition_path");
  if (cp !== null && !reSearch(cp, p)) return false;
  const cf = s(r, "condition_filename");
  if (cf !== null && !reSearch(cf, fileName(p))) return false;
  return true;
}

function fileTimeMicros(p: string, prop: string | null): Micros | null {
  try {
    const st = statSync(p, { bigint: true });
    // os.path.getctime is the creation time on Windows.
    const ns = prop === "mtime" ? st.mtimeNs : prop === "ctime" ? (process.platform === "win32" ? st.birthtimeNs : st.ctimeNs) : null;
    return ns === null ? null : Number(ns / 1000n);
  } catch {
    return null;
  }
}

function apply(r: Rule, p: string, exif: Map<string, PyValue | null>, ctx: Inputs): Micros | null {
  if (!checkConditions(r, p, exif)) return null;
  try {
    switch (s(r, "rule_type")) {
      case "exif": {
        const tag = s(r, "exif_tag");
        const v = tag === null ? null : exif.get(tag);
        if (v == null || !truthy(v)) return null;
        return transform(r, extractNoTz(valueStr(v), REGEXP_NO_TZ, null), ctx);
      }
      case "path": {
        const part = s(r, "path_part");
        const source = part === null || part === "filename" ? fileName(p) : part === "full_path" ? p : null;
        if (source === null) return null;
        const custom = s(r, "custom_regexp");
        let dt: Micros | null;
        if (custom) {
          const re = pyRegex(custom);
          if (!re) return null;
          dt = extractNoTz(source, re, null);
        } else {
          const pre = s(r, "predefined_regexp") ?? "default";
          if (pre === "default") dt = extractNoTz(source, REGEXP_NO_TZ, null);
          else if (pre === "whatsapp") dt = extractNoTz(source, REGEXP_WHATSAPP, WHATSAPP_MAPPING);
          else return null;
        }
        return transform(r, dt, ctx);
      }
      case "filesystem":
        return transform(r, fileTimeMicros(p, s(r, "file_property")), ctx);
      case "user_defined":
        return ctx.userDefinedTimestamp;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** The owner's rules from api_user.datetime_rules (a JSON string holding the list, or the list). */
export function rulesFromUser(value: unknown): Rule[] {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = null;
    }
  }
  return Array.isArray(list) ? list.filter((x): x is Rule => !!x && typeof x === "object" && !Array.isArray(x)) : [];
}

/** extract_local_date_time. */
export function extractLocalDateTime(p: string, rules: Rule[], exif: Map<string, PyValue | null>, ctx: Inputs): Micros | null {
  for (const r of rules) {
    const v = apply(r, p, exif, ctx);
    if (v !== null) return v;
  }
  return null;
}

// ---- rendering ------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 'YYYY-MM-DD HH:MM:SS.ffffff+00' for a ::timestamptz parameter. */
export function toPgTimestamp(us: Micros): string {
  const ms = Math.floor(us / 1000);
  const frac = us - ms * 1000;
  const d = new Date(ms);
  const micro = d.getUTCMilliseconds() * 1000 + frac;
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(micro, 6)}+00`;
}

/** The UTC date part ('YYYY-MM-DD'). */
export function toPgDate(us: Micros): string {
  const d = new Date(Math.floor(us / 1000));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse 'YYYY-MM-DD HH:MM:SS[.ffffff]' (UTC text from SQL) into Micros. */
export function fromPgText(t: string | null | undefined): Micros | null {
  if (!t) return null;
  const m = /^(-?\d+)-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?/.exec(t);
  if (!m) return null;
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setUTCHours(Number(m[4]), Number(m[5]), Number(m[6]), 0);
  return d.getTime() * 1000 + Number((m[7] ?? "").padEnd(6, "0"));
}
