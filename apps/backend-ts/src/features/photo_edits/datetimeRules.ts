// Port of api/date_time_extractor.py (via lp_api::photo_edits::datetime_rules):
// the owner's datetime rules, applied in order until one yields a capture
// time. The result is local time labelled UTC, as Django stores it. EXIF
// tags are read lazily (every tag the rules need, in one read) the first
// time a rule needs them, so the usual "Timestamp set by user" first rule
// never touches the file.
import { statSync } from "node:fs";
import { pyTruthy } from "~/lib/query";
import { tzNameAt } from "./tzfinder";

/** A wall-clock datetime with microseconds (no zone). */
export interface Naive {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  us: number;
}

type Rule = Record<string, unknown>;

export interface RuleInput {
  path: string;
  gpsLat: number | null;
  gpsLon: number | null;
  userDefaultTz: string;
  /** The user-set timestamp as micro-epoch, or null. */
  userDefined: bigint | null;
}

const groupRange = (a: number, b: number) =>
  "(" +
  Array.from({ length: b - a }, (_, i) => String(a + i).padStart(2, "0")).join("|") +
  ")";

const DELIM = "[-:_\\., ]*";
const REGEXP_NO_TZ = new RegExp(
  "(?<!\\d)" +
    ["((?:19|20|21)\\d\\d)", groupRange(1, 13), groupRange(1, 32), groupRange(0, 24), "([0-5]\\d)", "([0-5]\\d)"].join(DELIM),
);
const REGEXP_WHATSAPP = /^(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})(?:[-_]WA(\d+))?/;
const WHATSAPP_MAPPING = ["year", "month", "day", "microsecond"];

/** json.loads(user.datetime_rules): stored double-encoded by Django. */
export function parseRules(stored: unknown): Rule[] {
  let decoded = stored;
  if (typeof stored === "string") {
    try {
      decoded = JSON.parse(stored);
    } catch {
      decoded = null;
    }
  }
  if (!Array.isArray(decoded)) return [];
  return decoded.filter((v): v is Rule => !!v && typeof v === "object" && !Array.isArray(v));
}

const param = (r: Rule, k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);

function conditionExif(r: Rule): [string, string] | undefined {
  const raw = param(r, "condition_exif");
  if (raw === undefined) return undefined;
  const i = raw.indexOf("//");
  return i < 0 ? undefined : [raw.slice(0, i), raw.slice(i + 2)];
}

const needsExif = (r: Rule) => conditionExif(r) !== undefined || param(r, "rule_type") === "exif";

/** get_required_exif_tags over every rule, deduplicated, in first-seen order. */
export function requiredTags(rules: Rule[]): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  for (const r of rules) {
    const c = conditionExif(r);
    if (c) push(c[0]);
    const tag = param(r, "exif_tag");
    if (param(r, "rule_type") === "exif" && tag !== undefined) push(tag);
  }
  return out;
}

function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  return JSON.stringify(v);
}

const fileName = (p: string) => p.split(/[/\\]/).pop() ?? p;

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Python regex -> JS: Rust uses fancy_regex; lookbehind and the usual syntax carry over. */
function compile(p: string): RegExp | undefined {
  try {
    return new RegExp(p, "u");
  } catch {
    try {
      return new RegExp(p);
    } catch {
      return undefined;
    }
  }
}

/** _extract_no_tz_datetime_from_str */
export function extractNoTz(x: string, re: RegExp, mapping?: string[]): Naive | undefined {
  const m = re.exec(x);
  if (!m) return undefined;
  const groups = m.slice(1);
  // year, month, day, hour, minute, second, microsecond
  const args: (number | undefined)[] = [undefined, undefined, undefined, 0, 0, 0, 0];
  const num = (g: string | undefined) => (g !== undefined && /^\d+$/.test(g) ? Number(g) : undefined);
  if (!mapping) {
    for (let i = 0; i < Math.min(7, groups.length); i++) {
      const v = num(groups[i]);
      if (v === undefined) return undefined;
      args[i] = v;
    }
    if (groups.length < 3) return undefined;
  } else {
    if (groups.length > mapping.length) return undefined;
    const idx: Record<string, number> = { year: 0, month: 1, day: 2, hour: 3, minute: 4, second: 5, microsecond: 6 };
    for (let i = 0; i < groups.length; i++) {
      const j = idx[mapping[i]];
      if (j === undefined) return undefined;
      if (groups[i] !== undefined) {
        const v = num(groups[i]);
        if (v === undefined) return undefined;
        args[j] = v;
      }
    }
  }
  const [y, mo, d, h, mi, s, us] = args;
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined || s === undefined || us === undefined)
    return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59 || us > 999_999) return undefined;
  const dt: Naive = { y, mo, d, h, mi, s, us };
  // More than 30 days in the future: not a capture time.
  if ((naiveToMicros(dt) - BigInt(Date.now()) * 1000n) / 86_400_000_000n > 30n) return undefined;
  return dt;
}

/** The naive datetime read as UTC, in micro-epoch. */
export function naiveToMicros(n: Naive): bigint {
  return BigInt(Date.UTC(n.y, n.mo - 1, n.d, n.h, n.mi, n.s)) * 1000n + BigInt(n.us);
}

export function microsToNaive(us: bigint): Naive {
  const ms = Number(us / 1000n - (us % 1000n < 0n ? 1n : 0n));
  const rem = Number(((us % 1_000_000n) + 1_000_000n) % 1_000_000n);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), us: rem };
}

/** Postgres-ready text of a micro-epoch instant. */
export function microsToIso(us: bigint): string {
  const n = microsToNaive(us);
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${p(n.y, 4)}-${p(n.mo)}-${p(n.d)}T${p(n.h)}:${p(n.mi)}:${p(n.s)}.${p(n.us, 6)}+00:00`;
}

/** UTC offset (ms) of zone `tz` at instant `ms`. */
function offsetMs(tz: string, ms: number): number {
  const f = fmtCache.get(tz) ?? new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  fmtCache.set(tz, f);
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return local - Math.floor(ms / 1000) * 1000;
}
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Zone = { kind: "utc" } | { kind: "named"; tz: string };

function gpsOk(lat: number | null, lon: number | null): [number, number] | undefined {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return undefined;
  return [lat, lon];
}

async function getTz(desc: string, input: RuleInput): Promise<Zone | undefined> {
  if (desc === "gps_timezonefinder") {
    const g = gpsOk(input.gpsLat, input.gpsLon);
    if (!g) return undefined;
    const name = await tzNameAt(g[0], g[1]);
    return name && validTz(name) ? { kind: "named", tz: name } : undefined;
  }
  if (desc === "user_default") return validTz(input.userDefaultTz) ? { kind: "named", tz: input.userDefaultTz } : undefined;
  // The server's local zone is taken to be UTC.
  if (desc === "server_local" || desc.toLowerCase() === "utc") return { kind: "utc" };
  if (desc.startsWith("name:")) {
    const tz = desc.slice(5);
    return validTz(tz) ? { kind: "named", tz } : undefined;
  }
  return undefined;
}

/** chrono's from_local_datetime(..).earliest(): undefined inside a DST gap. */
function localToInstant(tz: string, local: bigint): bigint | undefined {
  const lms = Number(local / 1000n);
  const cands = new Set([offsetMs(tz, lms - 86_400_000), offsetMs(tz, lms + 86_400_000), offsetMs(tz, lms)]);
  let best: bigint | undefined;
  for (const off of cands) {
    const inst = local - BigInt(off) * 1000n;
    if (offsetMs(tz, Number(inst / 1000n)) === off && (best === undefined || inst < best)) best = inst;
  }
  return best;
}

/** _transform_tz: reinterpret dt from source_tz into report_tz local time, labelled UTC. */
async function transformTz(rule: Rule, dt: Naive, input: RuleInput): Promise<bigint | undefined> {
  const local = naiveToMicros(dt);
  if (!pyTruthy(rule.transform_tz)) return local;
  const src = param(rule, "source_tz");
  const rep = param(rule, "report_tz");
  if (src === undefined || rep === undefined) return undefined;
  const source = await getTz(src, input);
  if (!source) return undefined;
  const report = await getTz(rep, input);
  if (!report) return undefined;
  const instant = source.kind === "utc" ? local : localToInstant(source.tz, local);
  if (instant === undefined) return undefined;
  return report.kind === "utc" ? instant : instant + BigInt(offsetMs(report.tz, Number(instant / 1000n))) * 1000n;
}

function checkConditions(rule: Rule, p: string, tags: Map<string, unknown>): boolean {
  const c = conditionExif(rule);
  if (c) {
    const v = tags.get(c[0]);
    if (!pyTruthy(v)) return false;
    const re = compile(c[1]);
    if (!re || !re.test(pyStr(v))) return false;
  }
  const cp = param(rule, "condition_path");
  if (cp !== undefined && !compile(cp)?.test(p)) return false;
  const cf = param(rule, "condition_filename");
  if (cf !== undefined && !compile(cf)?.test(fileName(p))) return false;
  return true;
}

function fileTime(p: string, prop: string): Naive | undefined {
  try {
    const st = statSync(p);
    const t = prop === "mtime" ? st.mtime : prop === "ctime" ? (st.birthtimeMs ? st.birthtime : st.mtime) : undefined;
    if (!t) return undefined;
    return microsToNaive(BigInt(t.getTime()) * 1000n);
  } catch {
    return undefined;
  }
}

async function apply(rule: Rule, input: RuleInput, tags: Map<string, unknown>): Promise<bigint | undefined> {
  if (!checkConditions(rule, input.path, tags)) return undefined;
  switch (param(rule, "rule_type")) {
    case "user_defined":
      return input.userDefined ?? undefined;
    case "exif": {
      const tag = param(rule, "exif_tag");
      if (tag === undefined) return undefined;
      const v = tags.get(tag);
      if (!pyTruthy(v)) return undefined;
      const dt = extractNoTz(pyStr(v), REGEXP_NO_TZ);
      return dt && transformTz(rule, dt, input);
    }
    case "path": {
      const part = param(rule, "path_part");
      const source = part === undefined || part === "filename" ? fileName(input.path) : part === "full_path" ? input.path : undefined;
      if (source === undefined) return undefined;
      const custom = param(rule, "custom_regexp");
      let dt: Naive | undefined;
      if (custom) {
        const re = compile(custom);
        dt = re && extractNoTz(source, re);
      } else {
        const which = param(rule, "predefined_regexp") ?? "default";
        if (which === "default") dt = extractNoTz(source, REGEXP_NO_TZ);
        else if (which === "whatsapp") dt = extractNoTz(source, REGEXP_WHATSAPP, WHATSAPP_MAPPING);
        else return undefined;
      }
      return dt && transformTz(rule, dt, input);
    }
    case "filesystem": {
      const prop = param(rule, "file_property");
      const dt = prop === undefined ? undefined : fileTime(input.path, prop);
      return dt && transformTz(rule, dt, input);
    }
    default:
      return undefined;
  }
}

/** extract_local_date_time; readTags is called at most once. Returns micro-epoch or null. */
export async function extractLocalDateTime(
  rules: Rule[],
  input: RuleInput,
  readTags: (tags: string[]) => Promise<unknown[]>,
): Promise<bigint | null> {
  let read = false;
  const tags = new Map<string, unknown>();
  for (const rule of rules) {
    if (needsExif(rule) && !read) {
      read = true;
      const wanted = requiredTags(rules);
      const values = await readTags(wanted);
      wanted.forEach((t, i) => tags.set(t, values[i]));
    }
    const dt = await apply(rule, input, tags);
    if (dt !== undefined) return dt;
  }
  return null;
}
