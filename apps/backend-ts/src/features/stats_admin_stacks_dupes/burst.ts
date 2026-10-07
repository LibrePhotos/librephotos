// api/burst_detection_rules.py: the user's burst rules (hard: EXIF tags and
// filename patterns; soft: timestamp proximity and visual similarity), plus
// the batched ExifTool tag reads they need (api.metadata.reader.get_metadata:
// ExifTool -G -n, XMP sidecars override the file). Port of jobs/{burst,exif}.rs.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pyTruthy } from "~/lib/query";
import { pyStr } from "./common";
import { hamming } from "./phash";

export const BURST_MODE = "MakerNotes:BurstMode";
export const CONTINUOUS_DRIVE = "MakerNotes:ContinuousDrive";
export const SEQUENCE_NUMBER = "MakerNotes:SequenceNumber";
export const IMAGE_NUMBER = "EXIF:ImageNumber";
export const SUBSEC_TIME_ORIGINAL = "EXIF:SubSecTimeOriginal";
export const CAMERA = "EXIF:Model";

/** A photo considered by burst detection (timestamps as epoch microseconds plus ISO text). */
export interface BurstCandidate {
  id: string;
  ts_us: number | null;
  ts_iso: string | null;
  added_us: number;
  main_file_path: string | null;
  has_metadata: boolean;
  camera_make: string | null;
  camera_model: string | null;
  perceptual_hash: string | null;
}

/** BURST_FILENAME_PATTERNS (all case-insensitive). */
const PATTERNS: [string, RegExp][] = [
  ["burst_suffix", /_BURST\d+/i],
  ["sequence_suffix", /_\d{3,}$/i],
  ["bracketed_sequence", /\(\d+\)$/i],
  ["samsung_burst", /_\d{3}_COVER/i],
  ["iphone_burst", /IMG_\d{4}_\d+/i],
];
const SUFFIX_PLAIN = /(_BURST\d+|_\d{3,}|\(\d+\))$/;
const SUFFIX_COVER = /(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$/i;

const regexCache = new Map<string, RegExp | null>();
/** Python-syntax pattern as a JS RegExp (a leading inline (?i) becomes the flag); null if invalid. */
function compile(pattern: string): RegExp | null {
  let re = regexCache.get(pattern);
  if (re !== undefined) return re;
  let src = pattern;
  let flags = "u";
  const m = /^\(\?([aiLmsux]+)\)/.exec(src);
  if (m) {
    src = src.slice(m[0].length);
    if (m[1].includes("i")) flags += "i";
    if (m[1].includes("m")) flags += "m";
    if (m[1].includes("s")) flags += "s";
  }
  src = src.replace(/\(\?P</g, "(?<").replace(/\(\?P=(\w+)\)/g, "\\k<$1>");
  try {
    re = new RegExp(src, flags);
  } catch {
    try {
      re = new RegExp(src, flags.replace("u", ""));
    } catch {
      re = null;
    }
  }
  if (regexCache.size > 256) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

/** re.search with a user-supplied pattern; an invalid pattern never matches. */
const search = (pattern: string, text: string) => compile(pattern)?.test(text) ?? false;

/** EXIF values of one photo by requested tag (null when absent); empty when the read failed. */
export type ExifTags = Map<string, unknown>;

export interface Rule {
  rule_type: string;
  category: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

/** as_rules: every config needs a rule_type. Throws on a malformed config. */
export function parseRules(config: unknown): Rule[] {
  const items = typeof config === "string" ? JSON.parse(config) : config;
  if (!Array.isArray(items)) throw new Error("burst_detection_rules is not a list");
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("a burst rule is not an object");
    const params = item as Record<string, unknown>;
    if (!("rule_type" in params)) throw new Error("'rule_type'");
    return {
      rule_type: pyStr(params.rule_type),
      category: "category" in params ? pyStr(params.category) : "hard",
      enabled: !("enabled" in params) || pyTruthy(params.enabled),
      params,
    };
  });
}

export const isHard = (r: Rule) => r.category === "hard" && r.enabled;
export const isSoft = (r: Rule) => r.category === "soft" && r.enabled;

const truthyStr = (r: Rule, key: string) => (pyTruthy(r.params[key]) ? pyStr(r.params[key]) : undefined);

/** get_required_exif_tags */
export function requiredExifTags(r: Rule): string[] {
  const tags: string[] = [];
  const cond = truthyStr(r, "condition_exif");
  if (cond !== undefined) tags.push(cond.split("//")[0]);
  if (r.rule_type === "exif_burst_mode") tags.push(BURST_MODE, CONTINUOUS_DRIVE);
  else if (r.rule_type === "exif_sequence_number") tags.push(SEQUENCE_NUMBER, IMAGE_NUMBER, SUBSEC_TIME_ORIGINAL);
  return tags;
}

/** Path pieces the way Python's os.path (and Rust's Path) see them on this platform. */
const SEP = process.platform === "win32" ? /[\\/]/ : /\//;
function splitPath(p: string): { dir: string; name: string } {
  let end = p.length;
  while (end > 1 && SEP.test(p[end - 1])) end--;
  const trimmed = p.slice(0, end);
  let i = trimmed.length - 1;
  while (i >= 0 && !SEP.test(trimmed[i])) i--;
  return { dir: i < 0 ? "" : trimmed.slice(0, Math.max(i, 1)), name: trimmed.slice(i + 1) };
}
function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

function conditionsHold(r: Rule, p: string, exif: ExifTags): boolean {
  const cp = truthyStr(r, "condition_path");
  if (cp !== undefined && !search(cp, p)) return false;
  const cf = truthyStr(r, "condition_filename");
  if (cf !== undefined && !search(cf, splitPath(p).name)) return false;
  const ce = truthyStr(r, "condition_exif");
  if (ce !== undefined) {
    const i = ce.indexOf("//");
    if (i < 0) return false;
    const v = exif.get(ce.slice(0, i));
    if (!pyTruthy(v) || !search(ce.slice(i + 2), pyStr(v))) return false;
  }
  return true;
}

type Hit = [boolean, string | null];

/** exif_tags.get(Tags.CAMERA, "unknown") inside an f-string. */
const camera = (exif: ExifTags) => (!exif.has(CAMERA) ? "unknown" : pyStr(exif.get(CAMERA) ?? null));

function utcStamp(us: number) {
  const d = new Date(Math.floor(us / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const keyed = (prefix: string, photo: BurstCandidate, exif: ExifTags): Hit =>
  photo.ts_us === null ? [true, null] : [true, `${prefix}_${camera(exif)}_${utcStamp(photo.ts_us)}`];

function exifBurstMode(photo: BurstCandidate, exif: ExifTags): Hit {
  const mode = exif.get(BURST_MODE);
  if (pyTruthy(mode) && ["1", "On", "True", "Yes"].includes(pyStr(mode))) return keyed("burst", photo, exif);
  const drive = exif.get(CONTINUOUS_DRIVE);
  if (pyTruthy(drive) && ["continuous", "on", "1"].includes(pyStr(drive).toLowerCase())) return keyed("burst", photo, exif);
  return [false, null];
}

function exifSequenceNumber(photo: BurstCandidate, exif: ExifTags): Hit {
  const v = exif.get(SEQUENCE_NUMBER);
  let valid = typeof v === "number" || typeof v === "boolean";
  if (typeof v === "string") valid = /^[+-]?\d+$/.test(v.trim().replace(/_/g, ""));
  return valid ? keyed("seq", photo, exif) : [false, null];
}

function filenamePattern(r: Rule, photo: BurstCandidate): Hit {
  if (photo.main_file_path === null) return [false, null];
  const { dir, name } = splitPath(photo.main_file_path);
  const basename = fileStem(name);
  const key = (withCover: boolean): Hit => [true, `filename_${dir}_${basename.replace(withCover ? SUFFIX_COVER : SUFFIX_PLAIN, "")}`];
  const custom = truthyStr(r, "custom_pattern");
  if (custom !== undefined) return search(custom, basename) ? key(false) : [false, null];
  const patternType = "pattern_type" in r.params ? pyStr(r.params.pattern_type) : "all";
  const matched = PATTERNS.some(([n, re]) => (patternType === "all" || n === patternType) && re.test(basename));
  return matched ? key(true) : [false, null];
}

/** is_burst_photo: whether the photo is part of a burst, and the key grouping it with the rest of that burst. */
export function isBurstPhoto(r: Rule, photo: BurstCandidate, exif: ExifTags): Hit {
  if (!r.enabled) return [false, null];
  if (!conditionsHold(r, photo.main_file_path ?? "", exif)) return [false, null];
  switch (r.rule_type) {
    case "exif_burst_mode":
      return exifBurstMode(photo, exif);
    case "exif_sequence_number":
      return exifSequenceNumber(photo, exif);
    case "filename_pattern":
      return filenamePattern(r, photo);
    default:
      return [false, null];
  }
}

/** group_photos_by_timestamp over photos ordered by timestamp (positions). */
export function groupByTimestamp(photos: BurstCandidate[], intervalMs: number, requireSameCamera: boolean): number[][] {
  const intervalUs = Math.round(intervalMs * 1000);
  const groups: number[][] = [];
  let current: number[] = [];
  let prev: { i: number; camera: string | null } | null = null;
  photos.forEach((p, i) => {
    if (p.ts_us === null) return;
    const cam = requireSameCamera && p.has_metadata ? `${p.camera_make ?? ""}_${p.camera_model ?? ""}` : null;
    if (prev === null) current = [i];
    else {
      const diff = p.ts_us - photos[prev.i].ts_us!;
      const sameCamera = cam !== null && prev.camera !== null && requireSameCamera ? cam === prev.camera : true;
      if (diff <= intervalUs && sameCamera) current.push(i);
      else {
        if (current.length >= 2) groups.push(current);
        current = [i];
      }
    }
    prev = { i, camera: cam };
  });
  if (current.length >= 2) groups.push(current);
  return groups;
}

/** group_photos_by_visual_similarity: runs of consecutive similar hashes (positions). */
export function groupByVisual(photos: BurstCandidate[], threshold: number): number[][] {
  const withHash = photos.flatMap((p, i) => (p.perceptual_hash ? [i] : []));
  if (withHash.length < 2) return [];
  const groups: number[][] = [];
  let current = [withHash[0]];
  for (let k = 1; k < withHash.length; k++) {
    const [a, b] = [withHash[k - 1], withHash[k]];
    if (hamming(photos[b].perceptual_hash!, photos[a].perceptual_hash!) <= threshold) current.push(b);
    else {
      if (current.length >= 2) groups.push(current);
      current = [b];
    }
  }
  if (current.length >= 2) groups.push(current);
  return groups;
}

// ------------------------------------------------------------ ExifTool reads

const CHUNK = 500;

/** Only plain tag names reach ExifTool (lp_exif::is_safe_tag). */
export const isSafeTag = (tag: string) => tag.length <= 128 && /^[A-Za-z0-9_][A-Za-z0-9_\-:*?#]*$/.test(tag);

/** get_sidecar_files_in_priority_order, highest priority first. */
function sidecars(media: string): string[] {
  const { name } = splitPath(media);
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? media.slice(0, media.length - (name.length - dot)) : media;
  return [`${base}.xmp`, `${base}.XMP`, `${media}.xmp`, `${media}.XMP`];
}

function splitTag(tag: string): [string, string] {
  const i = tag.lastIndexOf(":");
  return i < 0 ? ["", tag.toLowerCase()] : [tag.slice(0, i).toLowerCase(), tag.slice(i + 1).toLowerCase()];
}

/** The exif sidecar's _attribute: requested Group:Name against the keys ExifTool answered with. */
function attribute(data: Record<string, unknown>, tags: string[]): unknown[] {
  return tags.map((tag) => {
    if (!isSafeTag(tag)) return null;
    const [group, name] = splitTag(tag);
    for (const [k, v] of Object.entries(data)) {
      if (k === "SourceFile") continue;
      const [kg, kn] = splitTag(k);
      const nameOk = name.endsWith("-*") ? kn.startsWith(`${name.slice(0, -2)}-`) : kn === name;
      const groupOk = !group || !kg || group === kg || group.startsWith(`${kg}-`);
      if (nameOk && groupOk) return v ?? null;
    }
    return null;
  });
}

const fileKey = (p: string) => {
  const s = p.replace(/\\/g, "/");
  return process.platform === "win32" ? s.toLowerCase() : s;
};

async function runChunk(exiftool: string, files: string[], tags: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const dir = mkdtempSync(path.join(os.tmpdir(), "lp-burst-"));
  try {
    const argfile = path.join(dir, "args.txt");
    writeFileSync(argfile, ["-j", "-G", "-n", "-charset", "filename=utf8", ...tags.map((t) => `-${t}`), ...files, ""].join("\n"));
    const proc = Bun.spawn([exiftool, "-@", argfile], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return out;
    }
    if (!Array.isArray(parsed)) return out;
    for (const v of parsed) if (v && typeof v.SourceFile === "string") out.set(fileKey(v.SourceFile), v);
  } catch {
    // An ExifTool that cannot run yields no values, like a caught MetadataReadError.
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/**
 * Values of tags for every media file (null for a missing tag), the XMP
 * sidecars' values winning over the file's. A file ExifTool cannot read
 * yields no entry at all.
 */
export async function readTags(exiftool: string, media: string[], tags: string[], concurrency: number): Promise<Map<string, unknown[]>> {
  const safe = tags.filter(isSafeTag);
  const result = new Map<string, unknown[]>();
  if (!safe.length || !media.length) return result;
  const sources = new Set<string>();
  const plan: [string, string[]][] = [];
  // One argfile line per path: a line break in a file name would be an option of its own.
  for (const m of media) {
    if (/[\r\n]/.test(m)) continue;
    const files = [m, ...sidecars(m).filter((s) => existsSync(s)).reverse()];
    for (const f of files) sources.add(f);
    plan.push([m, files]);
  }
  const sorted = [...sources].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < sorted.length; i += CHUNK) chunks.push(sorted.slice(i, i + CHUNK));
  const answers = new Map<string, Record<string, unknown>>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length)) }, async () => {
      while (next < chunks.length) {
        const c = chunks[next++];
        for (const [k, v] of await runChunk(exiftool, c, safe)) answers.set(k, v);
      }
    }),
  );
  for (const [m, files] of plan) {
    const main = answers.get(fileKey(m));
    if (!main) continue;
    const values = attribute(main, tags);
    for (const f of files.slice(1)) {
      const data = answers.get(fileKey(f));
      if (!data) continue;
      attribute(data, tags).forEach((v, i) => {
        if (v !== null) values[i] = v;
      });
    }
    result.set(m, values);
  }
  return result;
}
