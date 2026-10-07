// Video conversion for the "Always transcode videos" setting (port of
// lp_media::transcode): the live stream (api/views/media.py
// build_live_command, VideoTranscoder), the seekable disk cache filled after
// it (api/transcode_cache.py), the ffmpeg CPU budget probes
// (api/ffmpeg_budget.py) and HDR tonemapping (api/video_color.py).
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, statSync, statfsSync, unlinkSync, utimesSync } from "node:fs";
import { availableParallelism } from "node:os";
import { config } from "~/lib/config";
import { TRANSCODED_DIR } from "./paths";
import { pjoin, pyFloat } from "./pyfmt";

const BYTES_PER_GB = 1024 * 1024 * 1024;
/** About 15 MB of output per minute; used only to judge whether a video fits. */
const ESTIMATED_BYTES_PER_SECOND = (15 * BYTES_PER_GB) / 1024 / 60;
const STALE_PART_MS = 6 * 60 * 60 * 1000;
const SPACE_CHECK_MS = 15_000;
const PART_SUFFIX = ".part";
const STDERR_TAIL_BYTES = 8192;
const HDR_TRANSFERS = ["smpte2084", "arib-std-b67"];
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
const FALLBACK_FILTER = "format=yuv420p";
const SCALE = "scale=-2:'min(720,ih)'";
const CACHE_PRESET = "veryfast";

const num = (name: string, d: number) => {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const tc = {
  cacheMaxGb: num("TRANSCODE_CACHE_MAX_GB", 10),
  cacheMinFreeGb: num("TRANSCODE_CACHE_MIN_FREE_GB", 2),
  cacheMaxConcurrent: num("TRANSCODE_CACHE_MAX_CONCURRENT", 1),
  cacheNice: num("TRANSCODE_CACHE_NICE", 10),
  liveCpuFraction: Math.max(1, num("TRANSCODE_LIVE_CPU_FRACTION", 2)),
  liveReadrate: num("TRANSCODE_LIVE_READRATE", 2),
  liveBurstSeconds: num("TRANSCODE_LIVE_BURST_SECONDS", 30),
};
const cores = availableParallelism();

/** What the video to convert is, independent of how it was looked up. */
export interface Source {
  imageHash: string;
  path: string;
  videoLength: string | null;
}

// ---------------------------------------------------------------- budget

/** ffmpeg_budget.cpu_share: cores / fraction, never fewer than one. */
export const cpuShare = (n: number, fraction: number) => (fraction < 1 ? n : Math.max(1, Math.floor(n / fraction)));

async function runCapture(bin: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
    const timer = setTimeout(() => proc.kill(), 30_000);
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timer);
    return out;
  } catch {
    return "";
  }
}

interface Probe {
  help: string;
  filters: string;
}
let probeOnce: Promise<Probe> | undefined;
const probe = () =>
  (probeOnce ??= (async () => ({
    help: await runCapture(config.ffmpeg, ["-hide_banner", "-h", "full"]),
    filters: await runCapture(config.ffmpeg, ["-hide_banner", "-filters"]),
  }))());

/** ffmpeg_budget.supports: whether -option is listed in -h full. */
const supports = (p: Probe, option: string) =>
  p.help.split("\n").some((l) => l.trim().split(" ")[0] === `-${option}`);

/** ffmpeg_budget.supports_filter. */
const supportsFilter = (p: Probe, name: string) =>
  p.filters.split("\n").some((l) => l.trim().split(/\s+/)[1] === name);

// ---------------------------------------------------------------- colour

/** video_color.transfer_characteristics: "" whenever it cannot be had. */
async function transferCharacteristics(path: string): Promise<string> {
  const out = await runCapture(config.ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "json", path,
  ]);
  try {
    const v = JSON.parse(out)?.streams?.[0]?.color_transfer;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** video_color.video_filter(path, scale). */
async function videoFilter(path: string, scale: string): Promise<string | undefined> {
  const steps = [scale];
  if (HDR_TRANSFERS.includes(await transferCharacteristics(path))) {
    if (supportsFilter(await probe(), "zscale")) steps.push(TONEMAP);
    else {
      console.warn(`this ffmpeg has no zscale; cannot tonemap ${path}`);
      steps.push(FALLBACK_FILTER);
    }
  }
  const joined = steps.join(",");
  return joined === "" ? undefined : joined;
}

// ---------------------------------------------------------------- live

/** build_live_command: argv after the ffmpeg binary. */
export async function liveArgs(path: string): Promise<string[]> {
  const threads = String(cpuShare(cores, tc.liveCpuFraction));
  const p = await probe();
  const args = ["-nostdin", "-loglevel", "error", "-threads", threads];
  if (supports(p, "filter_threads")) args.push("-filter_threads", threads);
  if (tc.liveReadrate > 0 && supports(p, "readrate")) {
    args.push("-readrate", pyFloat(tc.liveReadrate));
    if (tc.liveBurstSeconds > 0 && supports(p, "readrate_initial_burst")) {
      args.push("-readrate_initial_burst", pyFloat(tc.liveBurstSeconds));
    }
  }
  args.push("-i", path, "-threads", threads, "-vcodec", "libx264", "-preset", "ultrafast", "-movflags", "frag_keyframe+empty_moov");
  const filter = await videoFilter(path, SCALE);
  if (filter) args.push("-filter:v", filter);
  args.push("-f", "mp4", "-");
  return args;
}

/**
 * _transcoded_video_response without a cache hit: ffmpeg's fragmented mp4
 * streamed as the body, Cache-Control: no-store. A HEAD gets the headers
 * only (no conversion), and still starts caching. When the body ends or the
 * viewer leaves, ffmpeg is stopped and the cache starts filling.
 */
export async function liveResponse(source: Source, head: boolean): Promise<Response> {
  const headers = { "Content-Type": "video/mp4", "Cache-Control": "no-store" };
  if (head) {
    void ensureCached(source);
    return new Response(null, { status: 200, headers });
  }
  const body = await spawnLive(source);
  if (!body) return new Response(null, { status: 500 });
  return new Response(body, { status: 200, headers });
}

async function spawnLive(source: Source): Promise<ReadableStream<Uint8Array> | undefined> {
  const args = await liveArgs(source.path);
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([config.ffmpeg, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  } catch (e) {
    console.warn("could not start the live transcode:", e);
    return undefined;
  }
  let tail = new Uint8Array(0);
  void (async () => {
    for await (const chunk of proc.stderr) {
      const merged = new Uint8Array(tail.length + chunk.length);
      merged.set(tail);
      merged.set(chunk, tail.length);
      tail = merged.length > STDERR_TAIL_BYTES ? merged.slice(merged.length - STDERR_TAIL_BYTES) : merged;
    }
  })().catch(() => {});
  const reader = proc.stdout.getReader();
  let finished = false;
  let settled = false;
  const after = async () => {
    if (settled) return;
    settled = true;
    if (!finished) proc.kill();
    const code = await proc.exited;
    if (finished && code !== 0) {
      const said = new TextDecoder().decode(tail).trim();
      console.warn(`live video transcode failed (status ${code}): ${said || "no output on stderr"}`);
    }
    await ensureCached(source);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          finished = true;
          controller.close();
          void after();
        } else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
        void after();
      }
    },
    cancel() {
      void after();
    },
  });
}

// ---------------------------------------------------------------- cache

const cacheRoot = () => TRANSCODED_DIR;
const maxBytes = () => tc.cacheMaxGb * BYTES_PER_GB;
const minFreeBytes = () => tc.cacheMinFreeGb * BYTES_PER_GB;

/** transcode_cache.is_enabled. */
export const isEnabled = () => maxBytes() > 0;

/** transcode_cache.final_path. */
export const finalPath = (imageHash: string) => (imageHash === "" ? undefined : pjoin(cacheRoot(), `${imageHash}.mp4`));

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** transcode_cache.cached_path: the finished conversion, stamped as just used (mtime = eviction order). */
export function cachedPath(imageHash: string): string | undefined {
  if (!isEnabled()) return undefined;
  const p = finalPath(imageHash);
  if (!p || !isFile(p)) return undefined;
  try {
    const now = new Date();
    utimesSync(p, now, now);
  } catch {
    // eviction order only
  }
  return p;
}

/** transcode_cache.discard: forget a deleted photo's conversion. */
export function discard(imageHash: string): void {
  const p = finalPath(imageHash);
  if (!p) return;
  for (const candidate of [p, p + PART_SUFFIX]) {
    if (!existsSync(candidate)) continue;
    try {
      unlinkSync(candidate);
    } catch {
      console.warn(`could not remove cached transcode ${candidate}`);
    }
  }
}

/** transcode_cache.estimated_size. */
export function estimatedSize(videoLength: string | null): number {
  const t = videoLength?.trim() ?? "";
  let seconds = t !== "" && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : 0;
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 60;
  return Math.floor(seconds * ESTIMATED_BYTES_PER_SECOND);
}

const isPart = (name: string) => name.endsWith(PART_SUFFIX);

function list(root: string): string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

/** Finished cache files, least recently used first. */
function entries(root: string): { path: string; mtime: number; size: number }[] {
  const out: { path: string; mtime: number; size: number }[] = [];
  for (const name of list(root)) {
    if (isPart(name)) continue;
    const p = pjoin(root, name);
    try {
      const st = statSync(p);
      if (st.isFile()) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    } catch {
      // vanished
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}

const inFlight = (root: string) => list(root).filter(isPart).length;

function dropStaleParts(root: string): void {
  const now = Date.now();
  for (const name of list(root)) {
    if (!isPart(name)) continue;
    const p = pjoin(root, name);
    try {
      if (now - statSync(p).mtimeMs > STALE_PART_MS) {
        unlinkSync(p);
        console.info(`removed abandoned transcode ${p}`);
      }
    } catch {
      // raced with its owner
    }
  }
}

/** Free bytes on the volume holding root (0 when unknown). */
export function freeBytes(root: string): number {
  try {
    const s = statfsSync(root);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return 0;
  }
}

/** transcode_cache.make_room: evict least recently served until wanted fits under both ceilings. */
function makeRoom(root: string, wanted: number): boolean {
  const all = entries(root);
  let used = all.reduce((s, e) => s + e.size, 0);
  const budget = maxBytes();
  const reserve = minFreeBytes();
  for (const e of all) {
    if (used + wanted <= budget && freeBytes(root) - wanted >= reserve) return true;
    try {
      unlinkSync(e.path);
    } catch {
      continue;
    }
    used -= e.size;
    console.info(`evicted cached transcode ${e.path}`);
  }
  return used + wanted <= budget && freeBytes(root) - wanted >= reserve;
}

/** transcode_cache.build_command: argv including the program. */
export async function cacheCommand(source: string, destination: string): Promise<string[]> {
  const threads = String(Math.max(1, Math.floor(cores / 2)));
  const args = ["-nostdin", "-loglevel", "error", "-y", "-i", source, "-threads", threads, "-vcodec", "libx264", "-preset", CACHE_PRESET];
  const filter = await videoFilter(source, SCALE);
  if (filter) args.push("-filter:v", filter);
  args.push("-movflags", "+faststart", "-f", "mp4", destination);
  const nice = process.platform !== "win32" && tc.cacheNice !== 0 ? Bun.which("nice") : null;
  return nice ? [nice, "-n", String(tc.cacheNice), config.ffmpeg, ...args] : [config.ffmpeg, ...args];
}

const tryUnlink = (p: string) => {
  try {
    unlinkSync(p);
  } catch {
    // already gone
  }
};

/**
 * transcode_cache.run_transcode: convert into part, publish as final by
 * rename only if ffmpeg exited cleanly with output and the disk held.
 */
async function runTranscode(argv: string[], part: string, final: string): Promise<boolean> {
  const root = cacheRoot();
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
  } catch (e) {
    console.warn(`could not start a transcode for ${final}:`, e);
    tryUnlink(part);
    return false;
  }
  let code: number;
  for (;;) {
    const r = await Promise.race([proc.exited, Bun.sleep(SPACE_CHECK_MS).then(() => undefined)]);
    if (r !== undefined) {
      code = r;
      break;
    }
    if (freeBytes(root) < minFreeBytes()) {
      proc.kill();
      await proc.exited;
      console.info(`abandoned caching ${final}: the disk is close to full`);
      tryUnlink(part);
      return false;
    }
  }
  if (code !== 0) {
    console.warn(`transcode failed: ${final}`);
    tryUnlink(part);
    return false;
  }
  let size = 0;
  try {
    size = statSync(part).size;
  } catch {
    // treated as empty
  }
  if (size <= 0) {
    tryUnlink(part);
    return false;
  }
  try {
    renameSync(part, final);
  } catch (e) {
    console.warn(`could not publish cached transcode ${final}:`, e);
    tryUnlink(part);
    return false;
  }
  console.info(`cached a seekable copy ${final}`);
  return true;
}

function claim(final: string, videoLength: string | null): string | undefined {
  if (isFile(final)) return undefined;
  const root = cacheRoot();
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    console.warn(`cannot create the transcode cache ${root}`);
    return undefined;
  }
  dropStaleParts(root);
  if (inFlight(root) >= Math.max(1, tc.cacheMaxConcurrent)) return undefined;
  if (!makeRoom(root, estimatedSize(videoLength))) {
    console.info(`no room to cache a transcode ${final}`);
    return undefined;
  }
  const part = final + PART_SUFFIX;
  try {
    closeSync(openSync(part, "wx"));
    return part;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") console.warn(`cannot write to the transcode cache ${root}`);
    return undefined;
  }
}

/**
 * transcode_cache.ensure_cached: claim (O_EXCL part file) and run a
 * background conversion unless it is cached, claimed, over the concurrency
 * limit, or out of room. Returns whether a conversion ran.
 */
export async function ensureCached(source: Source): Promise<boolean> {
  try {
    if (!isEnabled()) return false;
    const final = finalPath(source.imageHash);
    if (!final) return false;
    const part = claim(final, source.videoLength);
    if (!part) return false;
    return await runTranscode(await cacheCommand(source.path, part), part, final);
  } catch (e) {
    console.warn("transcode cache failed:", e);
    return false;
  }
}
