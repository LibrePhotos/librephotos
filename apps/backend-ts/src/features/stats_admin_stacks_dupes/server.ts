// What the server says about itself (api/views/server_info.py,
// ServerStatsView / ServerLogs*View in api/views/dataviz.py): storage stats,
// image tag, per-user server stats, the log download and tail. Port of
// lp_api::stats_admin_stacks_dupes::server and lp_db's server reads.
import { closeSync, existsSync, openSync, readSync, statSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { rows } from "~/lib/db";
import { json } from "~/lib/http";
import { LOG_FILENAME } from "~/lib/logfile";
import type { QueryMap } from "~/lib/query";
import { pyRound } from "./common";

interface DiskUsage {
  total_storage: number;
  used_storage: number;
  free_storage: number;
}

/** shutil.disk_usage(path) */
function diskUsage(p: string): DiskUsage {
  try {
    const s = statfsSync(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total_storage: total, used_storage: Math.max(0, total - free), free_storage: free };
  } catch {
    return { total_storage: 0, used_storage: 0, free_storage: 0 };
  }
}

// Every page asks for it: cached for two seconds.
let usageCache: { at: number; value: DiskUsage } | null = null;
export function storageStats(): DiskUsage {
  if (usageCache && Date.now() - usageCache.at < 2000) return usageCache.value;
  const value = diskUsage(config.photos);
  usageCache = { at: Date.now(), value };
  return value;
}

async function revParse(dir: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "-c", `safe.directory=${dir}`, "rev-parse", "--short", "HEAD"], {
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill(), 5000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    if ((await proc.exited) !== 0) return null;
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * read_git_hash: GIT_HASH, else `git rev-parse --short HEAD` where the code
 * lives (the app dir, then the cwd), else IMAGE_TAG or "unknown"; once.
 */
let gitHash: Promise<string> | null = null;
function readGitHash(): Promise<string> {
  gitHash ??= (async () => {
    const env = process.env.GIT_HASH?.trim();
    if (env) return env;
    for (const dir of [path.dirname(Bun.main), process.cwd()]) {
      const h = await revParse(dir);
      if (h) return h;
    }
    return process.env.IMAGE_TAG || "unknown";
  })();
  return gitHash;
}

export async function imageTag() {
  return { image_tag: process.env.IMAGE_TAG ?? "", git_hash: await readGitHash() };
}

/** calc_megabytes: whole MiB, Python rounding. */
const megabytes = (bytes: number) => (bytes === 0 ? 0 : pyRound(bytes / 1024 / 1024, 0));

/**
 * min/max/mean/median of per-group counts as _aggregate_stats reports them:
 * min, max and mean turn 0 into null (`or None`); the median is the middle
 * value or the mean of the two middle ones.
 */
function aggregate(counts: number[]): [number | null, number | null, number | null, number | null] {
  if (!counts.length) return [null, null, null, null];
  const s = [...counts].sort((a, b) => a - b);
  const n = s.length;
  const nz = (v: number) => (v === 0 ? null : v);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 1 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return [nz(s[0]), nz(s[n - 1]), mean === 0 ? null : mean, median];
}

type Group = [number, number];

function photoGroupStats(groups: Group[]) {
  const [min, max, mean, median] = aggregate(groups.map((g) => g[0]));
  const [min_videos, max_videos, mean_videos, median_videos] = aggregate(groups.map((g) => g[1]));
  return { count: groups.length, min, max, mean, median, min_videos, max_videos, mean_videos, median_videos };
}

function personGroupStats(groups: Group[]) {
  const [min, max, mean, median] = aggregate(groups.map((g) => g[0]));
  return { count: groups.length, min, max, mean, median };
}

interface Totals {
  owner_id: number;
  size_sum: number | null;
  photos: number;
  videos: number;
  screenshots: number;
  documents: number;
  captions: number;
  generated_captions: number;
  favorites: number;
  hidden: number;
  public: number;
}

const albumGroups = (kind: string) =>
  `SELECT '${kind}'::text AS kind, a.owner_id, count(ap.photo_id)::int AS count,
     count(ap.photo_id) FILTER (WHERE ph.video)::int AS videos
   FROM api_album${kind} a LEFT JOIN api_album${kind}_photos ap ON ap.album${kind}_id = a.id
   LEFT JOIN api_photo ph ON ph.id = ap.photo_id GROUP BY a.id, a.owner_id`;

/** _get_user_stats for every real user: one query per figure family. */
async function userStats() {
  const [users, totals, groups, clusters] = await Promise.all([
    // Every user but the `deleted` placeholder (get_deleted_user).
    rows<{ id: number; joined: string }>(
      sql`SELECT id, to_char(date_joined AT TIME ZONE 'UTC', 'DD-MM-YYYY') AS joined FROM api_user WHERE username <> 'deleted' ORDER BY id`,
    ),
    rows<Totals>(sql`SELECT p.owner_id, sum(p.size)::float8 AS size_sum, count(*)::int AS photos,
        count(*) FILTER (WHERE p.video)::int AS videos,
        count(*) FILTER (WHERE p.is_screenshot)::int AS screenshots,
        count(*) FILTER (WHERE p.is_document)::int AS documents,
        count(*) FILTER (WHERE pc.captions_json ? 'user_caption')::int AS captions,
        count(*) FILTER (WHERE pc.captions_json ? 'im2txt')::int AS generated_captions,
        count(*) FILTER (WHERE p.rating >= u.favorite_min_rating)::int AS favorites,
        count(*) FILTER (WHERE p.hidden)::int AS hidden,
        count(*) FILTER (WHERE p.public)::int AS public
      FROM api_photo p JOIN api_user u ON u.id = p.owner_id
      LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id
      GROUP BY p.owner_id`),
    rows<{ kind: string; owner_id: number; count: number; videos: number }>(
      sql.raw(`${["user", "place", "thing", "auto"].map(albumGroups).join(" UNION ALL ")} UNION ALL
        SELECT 'person'::text, pe.cluster_owner_id, count(f.id)::int, 0
        FROM api_person pe LEFT JOIN api_face f ON f.person_id = pe.id
        WHERE pe.cluster_owner_id IS NOT NULL GROUP BY pe.id, pe.cluster_owner_id`),
    ),
    rows<{ owner_id: number; n: number }>(
      sql`SELECT owner_id, count(*)::int AS n FROM api_cluster WHERE owner_id IS NOT NULL GROUP BY owner_id`,
    ),
  ]);
  const byOwner = new Map(totals.map((t) => [t.owner_id, t]));
  const clusterCount = new Map(clusters.map((c) => [c.owner_id, c.n]));
  const byKind = new Map<string, Group[]>();
  for (const g of groups) {
    const k = `${g.owner_id}/${g.kind}`;
    const list = byKind.get(k);
    if (list) list.push([g.count, g.videos]);
    else byKind.set(k, [[g.count, g.videos]]);
  }
  return users.map((u) => {
    const t = byOwner.get(u.id);
    const kind = (k: string) => byKind.get(`${u.id}/${k}`) ?? [];
    return {
      date_joined: u.joined,
      total_file_size_in_mb: megabytes(t?.size_sum ?? 0),
      number_of_photos: t?.photos ?? 0,
      number_of_videos: t?.videos ?? 0,
      number_of_screenshots: t?.screenshots ?? 0,
      number_of_documents: t?.documents ?? 0,
      number_of_captions: t?.captions ?? 0,
      number_of_generated_captions: t?.generated_captions ?? 0,
      album: photoGroupStats(kind("user")),
      person: personGroupStats(kind("person")),
      number_of_clusters: clusterCount.get(u.id) ?? 0,
      places: photoGroupStats(kind("place")),
      things: photoGroupStats(kind("thing")),
      events: photoGroupStats(kind("auto")),
      number_of_favorites: t?.favorites ?? 0,
      number_of_hidden: t?.hidden ?? 0,
      number_of_public: t?.public ?? 0,
    };
  });
}

/** py-cpuinfo's fields the frontend schema requires. */
function cpuInfo() {
  const cpus = os.cpus();
  const first = cpus[0];
  const mhz = first?.speed ?? 0;
  const hz = mhz * 1_000_000;
  const friendly = `${(mhz / 1000).toFixed(4)} GHz`;
  const arch = ({ x64: "X86_64", ia32: "X86_32", arm64: "ARM_8" } as Record<string, string>)[os.arch()] ?? os.arch().toUpperCase();
  return {
    python_version: "n/a (librephotos-ts)",
    cpuinfo_version: [0, 0, 0],
    cpuinfo_version_string: "node:os",
    arch,
    bits: 64,
    count: cpus.length,
    arch_string_raw: process.platform === "win32" && os.arch() === "x64" ? "AMD64" : os.machine(),
    vendor_id_raw: "",
    brand_raw: (first?.model ?? "").trim(),
    hz_advertised_friendly: friendly,
    hz_actual_friendly: friendly,
    hz_advertised: [hz, 0],
    hz_actual: [hz, 0],
    model: 0,
    flags: [] as string[],
  };
}

/** _get_gpu_info: the first NVIDIA GPU's name and memory (MB), else "". */
async function gpuInfo(): Promise<[string, number | string]> {
  try {
    const proc = Bun.spawn(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill(), 5000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    if ((await proc.exited) !== 0) return ["", ""];
    const line = out.trim().split(/\r?\n/)[0] ?? "";
    const i = line.indexOf(",");
    const name = (i < 0 ? line : line.slice(0, i)).trim();
    if (!name) return ["", ""];
    const mb = Number((i < 0 ? "" : line.slice(i + 1)).trim());
    return [name, i >= 0 && line.slice(i + 1).trim() !== "" && Number.isFinite(mb) ? Math.trunc(mb) : ""];
  } catch {
    return ["", ""];
  }
}

export async function serverStats() {
  const [users, [gpuName, gpuMemory]] = await Promise.all([userStats(), gpuInfo()]);
  const disk = diskUsage(path.parse(process.cwd()).root || "/");
  return {
    cpu_info: cpuInfo(),
    image_tag: process.env.IMAGE_TAG ?? "",
    available_ram_in_mb: megabytes(os.totalmem()),
    gpu_name: gpuName,
    gpu_memory_in_mb: gpuMemory,
    total_storage_in_mb: megabytes(disk.total_storage),
    used_storage_in_mb: megabytes(disk.used_storage),
    free_storage_in_mb: megabytes(disk.free_storage),
    number_of_users: users.length,
    users,
  };
}

const logPath = () => path.join(config.baseLogs, LOG_FILENAME);

/** GET /api/serverlogs: the whole log file as an attachment. */
export function serverLogs(): Response {
  const p = logPath();
  let size: number;
  try {
    size = statSync(p).size;
  } catch {
    return json({ error: "Log file not found" }, 404);
  }
  return new Response(Bun.file(p), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${LOG_FILENAME}"`,
      "Content-Length": String(size),
    },
  });
}

/** The last n lines of a file (each keeping its "\n"), read from the end; [bytes, line count]. */
export function tailLines(file: string, n: number): [Buffer, number] {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    let start = size;
    let buf = Buffer.alloc(0);
    let newlines = 0;
    // A final "\n" ends the last line rather than starting a new one.
    let skipFinal = true;
    scan: while (start > 0) {
      const chunk = Math.min(64 * 1024, start);
      start -= chunk;
      const piece = Buffer.alloc(chunk);
      readSync(fd, piece, 0, chunk, start);
      for (let i = piece.length - 1; i >= 0; i--) {
        if (piece[i] !== 0x0a) {
          skipFinal = false;
          continue;
        }
        if (skipFinal) {
          skipFinal = false;
          continue;
        }
        newlines++;
        if (newlines === n) {
          buf = Buffer.concat([piece.subarray(i + 1), buf]);
          break scan;
        }
      }
      buf = Buffer.concat([piece, buf]);
    }
    let count = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++;
    if (buf.length && buf[buf.length - 1] !== 0x0a) count++;
    return [buf, count];
  } finally {
    closeSync(fd);
  }
}

export function serverLogsView(q: QueryMap): Response {
  const raw = q.get("lines")?.trim();
  const parsed = raw !== undefined && /^[+-]?\d+$/.test(raw) ? Number(raw) : 100;
  const lines = Math.min(1000, Math.max(1, parsed));
  const p = logPath();
  if (!existsSync(p)) return json({ logs: "", count: 0, error: "Log file not found" }, 404);
  try {
    const [bytes, count] = tailLines(p, lines);
    return json({ logs: bytes.toString("utf8"), count });
  } catch (e) {
    console.error("reading the log file", e);
    return json({ logs: "", count: 0, error: "Failed to read log file" }, 500);
  }
}
