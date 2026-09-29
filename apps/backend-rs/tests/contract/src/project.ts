/**
 * Projection + comparison used by the twin diff.
 *
 * A projection is a list of paths into the JSON body, naming the fields the
 * frontend reads (03 §4, §6):
 *
 *   "count"                      a top-level field
 *   "results[].id"               a field of every element of an array
 *   "results[].items[].url"      nested arrays
 *   "results[].*"                every key of each element (values whole)
 *   "*"  or  ""                  the whole body
 *
 * A path that is absent from the body projects to MISSING, so "Django has it,
 * Rust doesn't" shows up as a difference instead of silently matching.
 */

export const MISSING = "<missing>";

type Selector = true | { [key: string]: Selector };

export interface CompareOptions {
  /** Array paths (projection syntax, without the trailing []) compared as multisets: "results", "results[].items". */
  unordered?: string[];
  /** Also compare numeric strings ("1.50") as numbers. */
  numericStrings?: boolean;
  /** Relative tolerance for numbers. */
  epsilon?: number;
  /** Origins stripped from absolute URLs (DRF next/previous) before comparing. */
  origins?: string[];
}

export interface Difference {
  path: string;
  ref: unknown;
  actual: unknown;
}

export function buildSelector(paths: string[]): Selector {
  if (paths.length === 0 || paths.some(p => p === "" || p === "*")) return true;
  const root: { [key: string]: Selector } = {};
  for (const path of paths) {
    let node: { [key: string]: Selector } = root;
    const steps = splitPath(path);
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      const existing = node[step];
      if (existing === true) return;
      if (last) {
        node[step] = true;
        return;
      }
      if (existing === undefined) node[step] = {};
      node = node[step] as { [key: string]: Selector };
    });
  }
  return root;
}

/** "results[].items[].id" -> ["results", "[]", "items", "[]", "id"] */
function splitPath(path: string): string[] {
  const steps: string[] = [];
  for (const segment of path.split(".")) {
    const m = /^([^[\]]*)((?:\[\])*)$/.exec(segment);
    if (!m) throw new Error(`bad projection path segment ${segment} in ${path}`);
    if (m[1]) steps.push(m[1]);
    for (let i = 0; i < m[2]!.length / 2; i++) steps.push("[]");
  }
  return steps;
}

export function project(value: unknown, selector: Selector): unknown {
  if (selector === true) return value;
  if (Array.isArray(value)) {
    const inner = selector["[]"];
    if (inner === undefined) return value;
    return value.map(v => project(v, inner));
  }
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(selector)) {
    if (key === "[]") continue;
    if (key === "*") {
      for (const k of Object.keys(obj)) out[k] = project(obj[k], sub);
    } else {
      out[key] = key in obj ? project(obj[key], sub) : MISSING;
    }
  }
  return out;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const NUMERIC = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Canonical form: datetimes as UTC instants, URL origins stripped, unordered arrays sorted. */
export function normalize(value: unknown, opts: CompareOptions = {}, path = ""): unknown {
  if (typeof value === "string") {
    if (ISO_DATETIME.test(value)) {
      const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.slice(10));
      const ms = Date.parse(hasZone ? value : `${value.replace(" ", "T")}Z`);
      if (!Number.isNaN(ms)) return `@instant ${new Date(ms).toISOString()}`;
    }
    if (opts.numericStrings && NUMERIC.test(value)) return Number(value);
    for (const origin of opts.origins ?? []) {
      if (origin && value.startsWith(origin)) return `<origin>${value.slice(origin.length)}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map(v => normalize(v, opts, `${path}[]`));
    if ((opts.unordered ?? []).includes(path)) {
      items.sort((a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0));
    }
    return items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v, opts, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function diff(ref: unknown, actual: unknown, opts: CompareOptions = {}, path = "", out: Difference[] = []): Difference[] {
  if (out.length >= 50) return out;
  if (typeof ref === "number" && typeof actual === "number") {
    const eps = opts.epsilon ?? 1e-9;
    if (Math.abs(ref - actual) > eps * Math.max(1, Math.abs(ref), Math.abs(actual))) {
      out.push({ path: path || "<root>", ref, actual });
    }
    return out;
  }
  if (Array.isArray(ref) && Array.isArray(actual)) {
    if (ref.length !== actual.length) {
      out.push({ path: `${path}.length`, ref: ref.length, actual: actual.length });
    }
    const n = Math.min(ref.length, actual.length);
    for (let i = 0; i < n; i++) diff(ref[i], actual[i], opts, `${path}[${i}]`, out);
    return out;
  }
  if (isObject(ref) && isObject(actual)) {
    const keys = new Set([...Object.keys(ref), ...Object.keys(actual)]);
    for (const k of keys) {
      diff(k in ref ? ref[k] : MISSING, k in actual ? actual[k] : MISSING, opts, path ? `${path}.${k}` : k, out);
    }
    return out;
  }
  if (canonical(ref) !== canonical(actual)) out.push({ path: path || "<root>", ref, actual });
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function formatDifferences(diffs: Difference[]): string {
  return diffs
    .map(d => `  ${d.path}: ref=${truncate(canonical(d.ref))} actual=${truncate(canonical(d.actual))}`)
    .join("\n");
}

function truncate(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
