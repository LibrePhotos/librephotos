// Walking, grouping and file typing (port of lp-ingest fsutil.rs:
// api/directory_watcher/utils.py, file_grouping.py, api/models/file.py and
// api/mime.py). Paths stay strings spelled the way the OS walk returned
// them, like Django's os.path.join results.
import { createHash } from "node:crypto";
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync, type Stats } from "node:fs";
import path from "node:path";

export const IMAGE = 1;
export const VIDEO = 2;
export const METADATA_FILE = 3;
export const RAW_FILE = 4;

/** FILE_TYPE_PRIORITY (lower wins main_file). */
export function typePriority(t: number): number {
  return ({ 1: 1, 2: 2, 4: 3, 3: 4, 5: 5 } as Record<number, number>)[t] ?? 999;
}

const RAW_FORMATS = new Set([
  ".RWZ", ".CR2", ".NRW", ".EIP", ".RAF", ".ERF", ".RW2", ".NEF", ".ARW", ".K25", ".DNG", ".SRF",
  ".DCR", ".RAW", ".CRW", ".BAY", ".3FR", ".CS1", ".MEF", ".ORF", ".ARI", ".SR2", ".KDC", ".MOS",
  ".MFW", ".FFF", ".CR3", ".SRW", ".RWL", ".J6I", ".KC2", ".X3F", ".MRW", ".IIQ", ".PEF", ".CXI",
  ".MDC",
]);

/** Python os.path.splitext on the full path string (`\` and `/` separators). */
export function splitext(p: string): [string, string] {
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1;
  const name = p.slice(sep);
  let lead = 0;
  while (lead < name.length && name[lead] === ".") lead++;
  const i = name.lastIndexOf(".");
  if (i < lead) return [p, ""];
  return [p.slice(0, sep + i), p.slice(sep + i)];
}

const extUpper = (p: string) => splitext(p)[1].toUpperCase();
export const isRaw = (p: string) => RAW_FORMATS.has(extUpper(p));
export const isMetadata = (p: string) => extUpper(p) === ".XMP";

/** Basename after the last `/` or `\`. */
export const fileName = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

// ---- content sniffing (`filetype`, as the Rust port's `infer`) ------------

const at = (b: Uint8Array, i: number, s: string) => {
  if (b.length < i + s.length) return false;
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};
const bytes = (b: Uint8Array, i: number, v: number[]) => b.length >= i + v.length && v.every((x, k) => b[i + k] === x);

function ftyp(b: Uint8Array): { major: string; compatible: string[] } | null {
  if (b.length < 16 || !at(b, 4, "ftyp")) return null;
  const len = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if (b.length < len) return null;
  const s = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  const compatible: string[] = [];
  const n = Math.max(0, Math.floor(len / 4) - 4);
  for (let k = 0; k < n && 16 + k * 4 + 4 <= b.length; k++) compatible.push(s(16 + k * 4));
  return { major: s(8), compatible };
}

const MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom", "mmp4", "mp41", "mp42", "mp4v", "mp71", "MSNV",
  "NDAS", "NDSC", "NSDC", "NDSH", "NDSM", "NDSP", "NDSS", "NDXC", "NDXH", "NDXM", "NDXP", "NDXS", "F4V ", "F4P ",
]);

function sniffImage(b: Uint8Array): string | null {
  if (bytes(b, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length > 12 && bytes(b, 0, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0])) return "image/jp2";
  if (bytes(b, 0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at(b, 0, "GIF")) return "image/gif";
  if (b.length > 11 && at(b, 8, "WEBP")) return "image/webp";
  const tiffHead = bytes(b, 0, [0x49, 0x49, 0x2a, 0]) || bytes(b, 0, [0x4d, 0x4d, 0, 0x2a]);
  const cr2 = b.length > 10 && tiffHead && b[8] === 0x43 && b[9] === 0x52 && b[10] === 0x02;
  if (cr2) return "image/x-canon-cr2";
  if (b.length > 9 && tiffHead && b[8] !== 0x43 && b[9] !== 0x52) return "image/tiff";
  if (bytes(b, 0, [0x42, 0x4d])) return "image/bmp";
  if (bytes(b, 0, [0x49, 0x49, 0xbc])) return "image/vnd.ms-photo";
  if (at(b, 0, "8BPS")) return "image/vnd.adobe.photoshop";
  if (b.length > 3 && bytes(b, 0, [0, 0, 1, 0])) return "image/vnd.microsoft.icon";
  const f = ftyp(b);
  if (f) {
    if (f.major === "heic" || f.major === "heix") return "image/heif";
    if ((f.major === "mif1" || f.major === "msf1") && f.compatible.includes("heic")) return "image/heif";
    if (f.major === "avif" || f.major === "avis" || f.compatible.some((c) => c === "avif" || c === "avis")) return "image/avif";
  }
  if ((b.length > 2 && b[0] === 0xff && b[1] === 0x0a) || (b.length > 12 && bytes(b, 0, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])))
    return "image/jxl";
  return null;
}

function sniffVideo(b: Uint8Array): string | null {
  if (b.length > 11 && at(b, 4, "ftyp") && MP4_BRANDS.has(String.fromCharCode(b[8], b[9], b[10], b[11]))) return "video/mp4";
  if (b.length > 10 && at(b, 4, "ftypM4V")) return "video/x-m4v";
  if ((b.length > 15 && bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88]) && at(b, 8, "matroska")) || (b.length > 38 && at(b, 31, "matroska")))
    return "video/x-matroska";
  if (bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (b.length > 15 && ((at(b, 4, "ftyp") && at(b, 8, "qt  ")) || at(b, 4, "moov") || at(b, 4, "mdat") || at(b, 12, "mdat")))
    return "video/quicktime";
  if (b.length > 10 && at(b, 0, "RIFF") && at(b, 8, "AVI")) return "video/x-msvideo";
  if (bytes(b, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9])) return "video/x-ms-wmv";
  if (b.length > 3 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] >= 0xb0 && b[3] <= 0xbf) return "video/mpeg";
  if (bytes(b, 0, [0x46, 0x4c, 0x56, 0x01])) return "video/x-flv";
  return null;
}

/** api.mime._is_mpeg_ts: 188-byte TS packets, or 192-byte M2TS ones. */
const isMpegTs = (h: Uint8Array) =>
  h.length >= 192 * 3 && ([0, 188, 376].every((i) => h[i] === 0x47) || [4, 196, 388].every((i) => h[i] === 0x47));

/** sniffed_mime_type of the first 8 KiB: magic bytes, else MPEG-TS, else null. */
export function sniffMimeHead(head: Uint8Array): string | null {
  return sniffImage(head) ?? sniffVideo(head) ?? (isMpegTs(head) ? "video/mp2t" : null);
}

export function readHead(p: string, n = 8192): Uint8Array | null {
  let fd: number;
  try {
    fd = openSync(p, "r");
  } catch {
    return null;
  }
  try {
    const buf = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const k = readSync(fd, buf, got, n - got, null);
      if (k === 0) break;
      got += k;
    }
    return buf.subarray(0, got);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export const sniffedMime = (p: string) => {
  const h = readHead(p);
  return h ? sniffMimeHead(h) : null;
};

const EXT_MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".jfif": "image/jpeg" };

/** mime_type: sniffed, else by extension, else octet-stream. */
export function mimeTypeOf(p: string, head?: Uint8Array | null): string {
  const h = head === undefined ? readHead(p) : head;
  return (h && sniffMimeHead(h)) ?? EXT_MIME[splitext(p)[1].toLowerCase()] ?? "application/octet-stream";
}

export const isVideoHead = (head: Uint8Array | null) => !!head && (sniffMimeHead(head) ?? "").includes("video");
export const isVideo = (p: string) => isVideoHead(readHead(p));

/** IMAGE_EXTENSIONS / VIDEO_EXTENSIONS (api/models/file.py), lowercase. */
const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".heic", ".heif", ".hif", ".j2k", ".jfif", ".jp2", ".jpe", ".jpeg", ".jpg", ".jxl", ".png", ".tif", ".tiff", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".3g2", ".3gp", ".asf", ".avi", ".flv", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".mts", ".ogv", ".vob", ".webm", ".wmv"]);

/** looks_like_media: whether a file the scanner could not load is still worth reporting. */
export function looksLikeMedia(p: string): boolean {
  const ext = splitext(p)[1].toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || isRaw(p) || isMetadata(p)) return true;
  const m = sniffedMime(p);
  return !!m && (m.startsWith("image/") || m.startsWith("video/"));
}

/** detect_file_type. */
export function detectFileType(p: string, head?: Uint8Array | null): number {
  let t = IMAGE;
  if (isRaw(p)) t = RAW_FILE;
  if (isVideoHead(head === undefined ? readHead(p) : head)) t = VIDEO;
  if (isMetadata(p)) t = METADATA_FILE;
  return t;
}

// ---- grouping -------------------------------------------------------------

/** `(directory, lowercase stem)` like get_file_grouping_key. */
export function groupingKey(p: string): [string, string] {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  let dir = "";
  let name = p;
  if (i >= 0) {
    let d = p.slice(0, i);
    // os.path.dirname keeps a root separator ("C:\\x" -> "C:\\").
    if (d === "" || d.endsWith(":")) d = p.slice(0, i + 1);
    else d = d.replace(/[/\\]+$/, "") || p.slice(0, i + 1);
    dir = d;
    name = p.slice(i + 1);
  }
  return [dir, splitext(name)[0].toLowerCase()];
}

/** get_sidecar_grouping_keys: `IMG.jpg.xmp` tries `img.jpg` then `img`. */
export function sidecarGroupingKeys(p: string): [string, string][] {
  const key = groupingKey(p);
  const [innerStem, innerExt] = splitext(key[1]);
  return innerExt ? [key, [key[0], innerStem]] : [key];
}

export const keyStr = (k: [string, string]) => `${k[0]}\u0000${k[1]}`;

// ---- walking --------------------------------------------------------------

/** SKIP_PATTERNS: `"a, b"` -> `["a", "b"]`. */
export const skipPatterns = (setting: string) => (setting ? setting.split(",").map((p) => p.trim()) : []);
const shouldSkip = (p: string, patterns: string[]) => patterns.some((x) => p.includes(x));

/**
 * Dot-files. Django and Rust also skip entries with the Windows hidden
 * attribute; node:fs does not expose file attributes, so TS does not (gap).
 */
const isHidden = (name: string) => name.startsWith(".");

/** walk_directory: follows symlinks, skips hidden entries, skip patterns, dangling links and loops. */
export function walkDirectory(directory: string, patterns: string[]): string[] {
  const out: string[] = [];
  const ancestors = new Set<string>();
  const walk = (dir: string) => {
    let identity: string;
    try {
      identity = realpathSync.native(dir);
      if (process.platform === "win32") identity = identity.toLowerCase();
    } catch {
      return;
    }
    if (ancestors.has(identity)) {
      console.warn(`skipping symlink loop back to a directory already being scanned: ${dir}`);
      return;
    }
    ancestors.add(identity);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const full = joinPy(dir, name);
      if (isHidden(name) || shouldSkip(full, patterns)) continue;
      let st: Stats;
      try {
        st = statSync(full);
      } catch {
        console.warn(`skipping: neither a file nor a directory (broken symlink?): ${full}`);
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(full);
      else console.warn(`skipping: neither a file nor a directory: ${full}`);
    }
    ancestors.delete(identity);
  };
  walk(directory);
  return out;
}

/** The file's mtime in ms since the epoch (null when unreadable). */
export function mtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

export const exists = (p: string) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** MD5 of the content + str(user_id). */
export const hashBytes = (data: Uint8Array, userId: number) => createHash("md5").update(data).digest("hex") + String(userId);

export async function calculateHash(p: string, userId: number): Promise<string> {
  return hashBytes(await Bun.file(p).bytes(), userId);
}

/** os.path.join(a, b) for a relative b: the OS separator unless `a` ends in one. */
export const joinPy = (a: string, b: string) => (a === "" || a.endsWith("/") || a.endsWith("\\") ? a + b : a + path.sep + b);

/** Stored paths are spelled with the OS separator (os.path.join). */
export const mediaName = (dir: string, file: string) => `${dir}${path.sep}${file}`;
