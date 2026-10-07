// /locclust/ and /folders/subfolders/ (port of lp_api::albums_tags::misc and
// lp_db::albums_tags::misc). Paths follow the host OS like Python's os.path.
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import type { QueryMap } from "~/lib/query";
import { folderPathPrefixes, likeEscape } from "~/lib/scope";
import type { User } from "~/lib/users";

/** Python/Rust string order (code points), not UTF-16 units. */
const cmpCodePoints = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

/** _location_cluster_row: [lat, lon, text] from a feature with a non-numeric text and a 2+ number center. */
function clusterRow(text: unknown, center: unknown): [number, number, string] | null {
  if (typeof text !== "string" || !text) return null;
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (/^[0-9]+$/.test(digits)) return null;
  if (!Array.isArray(center) || center.length < 2) return null;
  const num = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  };
  const lat = num(center[1]);
  const lon = num(center[0]);
  return lat === null || lon === null ? null : [lat, lon, text];
}

/**
 * GET /api/locclust/: one [lat, lon, name] per distinct place name of the
 * user's photos (first occurrence in table order wins), sorted by name. Only
 * the two keys leave the database, not the whole geolocation document.
 */
export async function locationClusters(user: User) {
  const rs = await rows<{ text: unknown; center: unknown }>(
    sql`SELECT f.value -> 'text' AS text, f.value -> 'center' AS center
        FROM api_photo p CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(p.geolocation_json) = 'object' AND jsonb_typeof(p.geolocation_json -> 'features') = 'array'
          THEN p.geolocation_json -> 'features' ELSE '[]'::jsonb END) WITH ORDINALITY AS f(value, ord)
        WHERE p.owner_id = ${user.id} AND p.geolocation_json IS NOT NULL AND jsonb_typeof(f.value) = 'object'`,
  );
  const byName = new Map<string, [number, number, string]>();
  for (const r of rs) {
    const c = clusterRow(r.text, r.center);
    if (c && !byName.has(c[2])) byName.set(c[2], c);
  }
  return [...byName.values()].sort((a, b) => cmpCodePoints(a[2], b[2]));
}

const PAGE_SIZE = 100;
const isWin = process.platform === "win32";
const SEP = path.sep;

const error = (status: number, message: string) => json({ error: message }, status);

/** os.path.normcase(os.path.abspath(p)). */
const normAbs = (p: string) => (isWin ? path.resolve(p).replaceAll("/", "\\").toLowerCase() : path.resolve(p));

/** api.util.is_valid_path: path is root or lies inside it. */
function isValidPath(p: string, root: string): boolean {
  const ap = normAbs(p);
  const ar = normAbs(root);
  if (ap === ar) return true;
  return ap.startsWith(ar.endsWith(SEP) ? ar : ar + SEP);
}

const isSep = (c: string) => c === "/" || (isWin && c === "\\");

/** os.path.join(base, name). */
function join(base: string, name: string): string {
  if (!base || isSep(base[base.length - 1]) || (isWin && base.endsWith(":"))) return base + name;
  return base + SEP + name;
}

/** os.path.dirname. */
function dirname(p: string): string {
  let idx = -1;
  for (let i = p.length - 1; i >= 0; i--)
    if (isSep(p[i])) {
      idx = i;
      break;
    }
  if (idx < 0) return "";
  const head = p.slice(0, idx + 1);
  let end = head.length;
  while (end > 0 && isSep(head[end - 1])) end--;
  const trimmed = head.slice(0, end);
  // Keep a root ("/", "C:\") intact, like Python does.
  return !trimmed || (isWin && trimmed.endsWith(":")) ? head : trimmed;
}

/** _scan_folder_entries: visible sub-directories by lower-cased name, mtime as Python's st_mtime. */
function scanEntries(base: string): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const name of fs.readdirSync(base)) {
    const p = join(base, name);
    let st: fs.BigIntStats;
    try {
      st = fs.statSync(p, { bigint: true });
    } catch {
      continue;
    }
    if (st.isDirectory() && !name.startsWith(".")) {
      const ns = st.mtimeNs;
      out.push([name, p, Number(ns / 1_000_000_000n) + Number(ns % 1_000_000_000n) * 1e-9]);
    }
  }
  return out.map((e, i) => ({ e, i, k: e[0].toLowerCase() })).sort((a, b) => cmpCodePoints(a.k, b.k) || a.i - b.i).map((x) => x.e);
}

/** Photos of the owner with a file inside each folder, one statement. */
async function folderPhotoCounts(ownerId: number, folders: string[]): Promise<number[]> {
  const cols = folders.map((f, i) => {
    const likes = folderPathPrefixes(f).map((pre) => sql`f.path LIKE ${likeEscape(pre) + "%"}`);
    return sql`count(DISTINCT p.id) FILTER (WHERE ${sql.join(likes, sql` OR `)})::int AS ${sql.raw(`c${i}`)}`;
  });
  const r = await row<Record<string, number>>(
    sql`SELECT ${sql.join(cols, sql`, `)} FROM api_photo p JOIN api_photo_files pf ON pf.photo_id = p.id
        JOIN api_file f ON f.hash = pf.file_id WHERE p.owner_id = ${ownerId}`,
  );
  return folders.map((_, i) => r![`c${i}`]);
}

/** GET /api/folders/subfolders/?path=&page= (FolderNavigationViewSet): admins browse DATA_ROOT, others their scan directory. */
export async function subfolders(user: User, q: QueryMap) {
  const rawPage = q.get("page");
  let page = 1;
  if (rawPage !== undefined) {
    const t = rawPage.trim();
    const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
    page = Number.isSafeInteger(n) && n >= 1 ? n : 1;
  }
  const isAdmin = user.isStaff;
  const dataRoot = config.photos;
  const scanDir = user.scanDirectory ? user.scanDirectory : null;
  let defaultPath: string;
  if (isAdmin) defaultPath = dataRoot;
  else if (scanDir) defaultPath = scanDir;
  else return error(403, "User scan directory not configured");
  const base = q.get("path") ?? defaultPath;
  if (isAdmin) {
    if (!isValidPath(base, dataRoot)) return error(403, "Access denied");
  } else {
    if (!scanDir) return error(403, "User scan directory not configured");
    if (!fs.existsSync(scanDir)) return error(403, "Scan directory does not exist");
    if (!isValidPath(base, scanDir)) return error(403, "Access denied - can only access folders within your scan directory");
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(base);
  } catch {
    return error(400, "Path does not exist");
  }
  if (!st.isDirectory()) return error(400, "Path is not a directory");
  let entries: [string, string, number][];
  try {
    entries = scanEntries(base);
  } catch (e) {
    console.error(`Error scanning directory ${base}: ${e}`);
    return error(500, "Error scanning directory");
  }
  const root = isAdmin ? dataRoot : user.scanDirectory;
  const total = entries.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);
  let subs: { name: string; path: string; photo_count: number; modified: number }[] = [];
  if (pageEntries.length) {
    const counts = await folderPhotoCounts(
      user.id,
      pageEntries.map((e) => e[1]),
    );
    subs = pageEntries
      .map(([name, p, modified], i) => ({ name, path: p, photo_count: counts[i], modified }))
      .filter((s) => s.photo_count > 0);
  }
  const totalPages = Math.ceil(total / PAGE_SIZE);
  return {
    current_path: base,
    parent_path: base !== root ? dirname(base) : null,
    subfolders: subs,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total_folders: total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_previous: page > 1,
    },
  };
}
