// Thumbnails (port of lp-ingest render.rs; api/thumbnails.py,
// Thumbnail._generate_thumbnail): big WebP <= 1080 px high, 500 / 250
// resized from it in memory, WebP Q95 effort 2, local_orientation on top of
// the EXIF autorotation; videos through ffmpeg with Django's arguments.
//
// sharp is libvips, and the pipeline below reproduces pyvips'
// `Image.thumbnail(path, 10000, height=h, size=DOWN)` exactly (JPEG
// shrink-on-load leaving a factor of two, lanczos3, no ICC transform): the
// VP8 bitstreams match Django's byte for byte. The colour profile is kept
// like Django's `keep=ICC`: sharp cannot attach a profile to raw pixels, so
// it is muxed into the WebP container here (VP8X + ICCP).
//
// Decoders, in order: libvips (sharp); for files it rejects (HEIC, JPEG XL,
// ...) Pillow through LP_PYTHON (`image_decoding._pillow_to_vips`); RAW files
// their embedded preview through rawpy (`image_decoding.raw_preview`, also
// in LP_PYTHON), else the thumbnail sidecar, else ExifTool's largest
// embedded JPEG.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Sharp } from "sharp";
import { loadSharp } from "../../lib/native";
import { config } from "../../lib/config";
import { exif } from "../../lib/exif";
import { isRaw, mediaName } from "./fsutil";

export const BIG = "thumbnails_big";
export const SQUARE = "square_thumbnails";
export const SQUARE_SMALL = "square_thumbnails_small";
export const STATIC_DIRS = [BIG, SQUARE, SQUARE_SMALL] as const;

/** ffmpeg copies the source's global metadata (a phone video's location) into its output. */
export const NO_METADATA = ["-map_metadata", "-1", "-map_chapters", "-1"];

export const heightOf = (dir: string) => (dir === BIG ? 1080 : dir === SQUARE ? 500 : 250);

const envInt = (k: string, lo: number, hi: number): number | undefined => {
  const raw = process.env[k]?.trim();
  if (!raw) return undefined;
  const v = Number(raw);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
};

const WEBP_Q = 95;
/** LP_THUMB_SMALL_Q: quality of the 500/250 px squares (default 80 like Rust; Django uses 95). */
export const SMALL_Q = envInt("LP_THUMB_SMALL_Q", 1, 100) ?? 80;
/** LP_THUMB_EFFORT / LP_THUMB_SMALL_EFFORT: libwebp effort (default 2 as Django). */
export const BIG_EFFORT = envInt("LP_THUMB_EFFORT", 0, 6) ?? 2;
export const SMALL_EFFORT = envInt("LP_THUMB_SMALL_EFFORT", 0, 6) ?? 2;
/** LP_THUMB_KEEP: icc (default) | none | all ("all" behaves like icc: sharp's raw path carries no EXIF). */
const KEEP_ICC = (process.env.LP_THUMB_KEEP ?? "icc").trim().toLowerCase() !== "none";
const FFMPEG_TIMEOUT_MS = 300_000;

// No operation cache (a cached load keeps the file open on Windows and hands
// back stale pixels for a file changed in place); one libvips thread per
// operation, as file groups already run side by side (LP_VIPS_CONCURRENCY).
// sharp.cache(false) and LP_VIPS_CONCURRENCY (1): src/lib/native.ts loadSharp().

type Input = string | Uint8Array;
export interface Pixels {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

const rawOpts = (p: Pixels) => ({ raw: { width: p.width, height: p.height, channels: p.channels } });
/**
 * Always bytes, never a path: libvips keeps a file it opened by name open,
 * and on Windows that blocks thumbnail rewrites and ExifTool's in-place
 * writes of originals.
 */
async function src(input: Input): Promise<Buffer> {
  const b = typeof input === "string" ? await Bun.file(input).bytes() : input;
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
}

const madeDirs = new Set<string>();
function ensureDirOf(file: string) {
  const d = path.dirname(file);
  if (!madeDirs.has(d)) {
    mkdirSync(d, { recursive: true });
    madeDirs.add(d);
  }
}

export async function writeFile(file: string, data: Uint8Array) {
  ensureDirOf(file);
  await Bun.write(file, data);
}

export const thumbPath = (dir: string, hash: string, ext: string) => path.join(config.mediaRoot, dir, `${hash}${ext}`);
/** The relative name stored in api_thumbnail (os.path.join(dir, hash + ext)). */
export const storedName = (dir: string, hash: string, ext: string) => mediaName(dir, `${hash}${ext}`);

export function ensureDirs() {
  for (const d of STATIC_DIRS) mkdirSync(path.join(config.mediaRoot, d), { recursive: true });
}

export const fileExists = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// ---- WebP container -----------------------------------------------------------

function chunk(fourcc: string, payload: Uint8Array): Buffer {
  const pad = payload.length & 1;
  const b = Buffer.alloc(8 + payload.length + pad);
  b.write(fourcc, 0, "latin1");
  b.writeUInt32LE(payload.length, 4);
  b.set(payload, 8);
  return b;
}

/** Mux an ICC profile into a WebP (VP8X + ICCP before the image chunks), as libwebp's WebPMux does. */
export function webpWithIcc(webp: Buffer, icc: Uint8Array | undefined, width: number, height: number): Buffer {
  if (!icc || !icc.length || webp.length < 12 || webp.toString("latin1", 8, 12) !== "WEBP") return webp;
  const chunks: [string, Buffer][] = [];
  for (let p = 12; p + 8 <= webp.length; ) {
    const cc = webp.toString("latin1", p, p + 4);
    const size = webp.readUInt32LE(p + 4);
    chunks.push([cc, webp.subarray(p, Math.min(p + 8 + size + (size & 1), webp.length))]);
    p += 8 + size + (size & 1);
  }
  let flags = 0x20;
  const rest: Buffer[] = [];
  for (const [cc, c] of chunks) {
    if (cc === "VP8X") flags |= c[8] & ~0x20;
    else if (cc !== "ICCP") rest.push(c);
    if (cc === "ALPH") flags |= 0x10;
  }
  const vp8x = Buffer.alloc(10);
  vp8x[0] = flags;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8X", vp8x), chunk("ICCP", icc), ...rest]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** WebP canvas size from its header (no decode), or null. */
export function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || String.fromCharCode(b[8], b[9], b[10], b[11]) !== "WEBP") return null;
  const cc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (cc === "VP8X") return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  if (cc === "VP8 ") return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff];
  if (cc === "VP8L") {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1];
  }
  return null;
}

/** Image size from the file header (Pillow's Image.open(...).size). */
export async function imageSize(file: string): Promise<[number, number] | null> {
  try {
    const head = new Uint8Array(await Bun.file(file).slice(0, 64).arrayBuffer());
    const s = webpSize(head);
    if (s) return s;
    const m = await (await loadSharp())(await src(file)).metadata();
    return m.width && m.height ? [m.width, m.height] : null;
  } catch {
    return null;
  }
}

// ---- pixels -------------------------------------------------------------------

/** Decode an encoded image (a WebP thumbnail) to pixels, no rotation. */
export async function decodePixels(input: Input): Promise<Pixels> {
  const { data, info } = await (await loadSharp())(await src(input)).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as Pixels["channels"] };
}

/** pyvips Image.thumbnail(f, 10000, height=h, size=DOWN): autorotated, untransformed colours. */
async function thumbnailPixels(input: Input, height: number): Promise<Pixels> {
  const { data, info } = await (await loadSharp())(await src(input), { failOn: "none", limitInputPixels: false })
    .rotate()
    .resize({ width: 10000, height, fit: "inside", withoutEnlargement: true, fastShrinkOnLoad: false })
    .keepIccProfile()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as Pixels["channels"] };
}

/** image.thumbnail_image(10000, height=h, size=DOWN) on pixels in memory. */
async function shrinkPixels(p: Pixels, height: number): Promise<Pixels> {
  if (p.height <= height) return p;
  const { data, info } = await (await loadSharp())(p.data, rawOpts(p))
    .resize({ width: 10000, height, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as Pixels["channels"] };
}

/** _apply_local_orientation (pyvips conventions: rot(D90) is a quarter turn clockwise). */
export async function orient(p: Pixels, o: number): Promise<Pixels> {
  const steps: ((s: Sharp) => Sharp)[] = {
    2: [(s: Sharp) => s.flop()],
    3: [(s: Sharp) => s.rotate(180)],
    4: [(s: Sharp) => s.flip()],
    5: [(s: Sharp) => s.rotate(90), (s: Sharp) => s.flop()],
    6: [(s: Sharp) => s.rotate(270)],
    7: [(s: Sharp) => s.rotate(270), (s: Sharp) => s.flop()],
    8: [(s: Sharp) => s.rotate(90)],
  }[o] ?? [];
  let cur = p;
  for (const step of steps) {
    const { data, info } = await step((await loadSharp())(cur.data, rawOpts(cur))).raw().toBuffer({ resolveWithObject: true });
    cur = { data, width: info.width, height: info.height, channels: info.channels as Pixels["channels"] };
  }
  return cur;
}

/** WebP of pixels (with `icc` muxed in when kept); effort null = libwebp's default (legacy). */
export async function encodeWebp(p: Pixels, quality: number, effort: number | null, icc?: Uint8Array): Promise<Buffer> {
  const out = await (await loadSharp())(p.data, rawOpts(p)).webp({ quality, ...(effort === null ? {} : { effort }) }).toBuffer();
  return KEEP_ICC ? webpWithIcc(out, icc, p.width, p.height) : out;
}

/** ICC profiles read by canDecode's header load, so the render does not parse the header again. */
const knownIcc = new WeakMap<object, Uint8Array | null>();

async function iccOf(input: Input): Promise<Uint8Array | undefined> {
  if (typeof input !== "string" && knownIcc.has(input)) return knownIcc.get(input) ?? undefined;
  try {
    return (await (await loadSharp())(await src(input)).metadata()).icc;
  } catch {
    return undefined;
  }
}

/** image_decoding.can_decode: a libvips header load, else a sniffed image type. */
export async function canDecode(input: Input, sniffed: string | null): Promise<boolean> {
  try {
    const m = await (await loadSharp())(await src(input)).metadata();
    if (typeof input !== "string") knownIcc.set(input, m.icc ?? null);
    return true;
  } catch {
    return !!sniffed && sniffed.startsWith("image/");
  }
}

// ---- Python helpers (Pillow, rawpy) -----------------------------------------

const PY_HELPER = String.raw`import sys
mode = sys.argv[1]
if mode == "pillow":
    from PIL import Image, ImageOps
    try:
        import pillow_heif; pillow_heif.register_heif_opener()
    except Exception:
        pass
    try:
        import pillow_jxl
    except Exception:
        pass
    Image.MAX_IMAGE_PIXELS = 250_000_000
    with Image.open(sys.argv[2]) as image:
        ImageOps.exif_transpose(image).convert("RGB").save(sys.argv[3], "PNG", compress_level=1)
elif mode == "rawpreview":
    import pyvips, rawpy
    path, height, out = sys.argv[2], int(sys.argv[3]), sys.argv[4]
    flip = {3: 3, 5: 8, 6: 6}
    try:
        with rawpy.imread(path) as raw:
            sizes = raw.sizes
            thumb = raw.extract_thumb()
        if thumb.format != rawpy.ThumbFormat.JPEG:
            print("none"); sys.exit(0)
        header = pyvips.Image.new_from_buffer(thumb.data, "")
    except Exception:
        print("none"); sys.exit(0)
    if not (header.width and header.height and sizes.width and sizes.height):
        print("none"); sys.exit(0)
    a, b = header.width / header.height, sizes.width / sizes.height
    if abs(a - b) > 0.02 * b:
        print("none"); sys.exit(0)
    orientation = flip.get(sizes.flip, 1)
    sideways = orientation in (6, 8)
    if (header.width if sideways else header.height) < min(height, sizes.width if sideways else sizes.height):
        print("none"); sys.exit(0)
    image = pyvips.Image.thumbnail_buffer(thumb.data, height if sideways else 100000,
        height=100000 if sideways else height, size=pyvips.enums.Size.DOWN, no_rotate=True).copy_memory()
    for field in image.get_fields():
        if field == "orientation" or field.startswith(("exif-", "xmp-")):
            image.remove(field)
    if orientation != 1:
        image.set_type(pyvips.GValue.gint_type, "orientation", orientation)
        image = image.autorot()
    image.write_to_file(out, compression=1)
    print("ok")
`;

const tmpName = (suffix: string) => path.join(tmpdir(), `lp-ts-${crypto.randomUUID()}${suffix}`);

async function runPython(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn([config.python, "-c", PY_HELPER, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { ok: code === 0, out: out.trim(), err };
}

const tail = (s: string) => {
  const t = s.trim();
  return t ? t.slice(-2000) : "no output";
};

/** Pillow + pillow-heif/jxl decode, EXIF-transposed, RGB, into a temp PNG. */
async function pillowDecode(file: string): Promise<string> {
  const out = tmpName(".png");
  const r = await runPython(["pillow", file, out]);
  if (!r.ok) {
    rmSync(out, { force: true });
    throw new Error(`no decoder for ${file}: ${tail(r.err)}`);
  }
  return out;
}

/** image_decoding.thumbnail: libvips, else Pillow's decode. */
async function decode(file: string, input: Input, height: number): Promise<Pixels> {
  try {
    return await thumbnailPixels(input, height);
  } catch (vipsErr) {
    let png: string;
    try {
      png = await pillowDecode(file);
    } catch (e) {
      throw new Error(`${(e as Error).message}: libvips: ${(vipsErr as Error).message}`);
    }
    try {
      return await thumbnailPixels(png, height);
    } finally {
      rmSync(png, { force: true });
    }
  }
}

/** image_decoding.raw_preview through rawpy: the oriented preview pixels, or null. */
async function rawPreview(file: string, height: number): Promise<Pixels | null> {
  const out = tmpName(".png");
  try {
    const r = await runPython(["rawpreview", file, String(height), out]);
    if (!r.ok || r.out !== "ok") return null;
    return await decodePixels(await Bun.file(out).bytes());
  } catch {
    return null;
  } finally {
    rmSync(out, { force: true });
  }
}

/** _request_raw_thumbnail: the thumbnail sidecar renders the RAW into `out`. */
async function rawSidecar(file: string, height: number, out: string, localOrientation: number) {
  // The service only writes under the media root; stage there, then move.
  const staged = out.startsWith(config.mediaRoot) ? null : path.join(config.mediaRoot, `.raw-render-${crypto.randomUUID()}.webp`);
  const target = staged ?? out;
  try {
    const res = await fetch(`${config.sidecar("thumbnail", 8003)}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: file, destination: target, height }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`RAW render of ${file} failed: HTTP ${res.status}`);
    await res.json();
    if (staged) await writeFile(out, await Bun.file(staged).bytes());
  } catch (e) {
    throw new Error(`RAW render of ${file} failed: ${(e as Error).message}`);
  } finally {
    if (staged) rmSync(staged, { force: true });
  }
  if (localOrientation > 1) {
    const p = await orient(await decodePixels(await Bun.file(out).bytes()), localOrientation);
    await writeFile(out, await encodeWebp(p, WEBP_Q, BIG_EFFORT));
  }
}

/** The largest JPEG ExifTool finds in a RAW file, upright by the file's orientation. */
async function exiftoolPreview(file: string, height: number): Promise<Pixels | null> {
  try {
    const out = await exif.execute(false, ["-j", "-b", "-JpgFromRaw", "-PreviewImage", "-OtherImage", "-ThumbnailImage", "-EXIF:Orientation", file]);
    const tags = (JSON.parse(out) as Record<string, unknown>[])[0] ?? {};
    let orientation = 1;
    let best: { px: number; data: Buffer } | null = null;
    for (const [k, v] of Object.entries(tags)) {
      if (k.endsWith(":Orientation")) orientation = typeof v === "number" ? v : 1;
      else if (typeof v === "string" && v.startsWith("base64:")) {
        const data = Buffer.from(v.slice(7), "base64");
        if (data[0] !== 0xff || data[1] !== 0xd8) continue;
        const m = await (await loadSharp())(data).metadata().catch(() => null);
        if (m?.width && m.height && (!best || m.width * m.height > best.px)) best = { px: m.width * m.height, data };
      }
    }
    if (!best) return null;
    const angle = ({ 3: 180, 6: 90, 8: 270 } as Record<number, number>)[orientation] ?? 0;
    const sideways = angle === 90 || angle === 270;
    const resize = sideways ? { width: height, withoutEnlargement: true } : { height, withoutEnlargement: true };
    const { data, info } = await (await loadSharp())(best.data).resize(resize).rotate(angle).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels as Pixels["channels"] };
  } catch {
    return null;
  }
}

/** _render_raw_thumbnail (big): the camera's preview, else the RAW renderer, else ExifTool's JPEG. */
async function rawBig(file: string, out: string, localOrientation: number, legacy: boolean): Promise<Pixels | null> {
  const height = heightOf(BIG);
  if (!legacy) {
    const prev = await rawPreview(file, height);
    if (prev) {
      const p = await orient(prev, localOrientation);
      await writeFile(out, await encodeWebp(p, WEBP_Q, BIG_EFFORT));
      return p;
    }
  }
  try {
    await rawSidecar(file, height, out, localOrientation);
    return null;
  } catch (err) {
    if (legacy) throw err;
    const prev = await exiftoolPreview(file, height);
    if (!prev) throw err;
    console.warn(`RAW render of ${file} failed; using its embedded JPEG instead: ${(err as Error).message}`);
    const p = await orient(prev, localOrientation);
    await writeFile(out, await encodeWebp(p, WEBP_Q, BIG_EFFORT));
    return p;
  }
}

export interface StaticResult {
  /** The big WebP as written, when rendered here (for the pHash). */
  big: Buffer | null;
  /** The 250 px square as written (for the dominant colour). */
  small: Buffer | null;
}

/** create_static_thumbnails for the missing `dirs`. `input` is the file's bytes when already read. */
export async function staticThumbnails(file: string, input: Input, hash: string, dirs: string[], localOrientation: number): Promise<StaticResult> {
  const bigPath = thumbPath(BIG, hash, ".webp");
  const result: StaticResult = { big: null, small: null };
  let big: Pixels | null = null;
  let icc: Uint8Array | undefined;
  if (dirs.includes(BIG)) {
    if (isRaw(file)) {
      big = await rawBig(file, bigPath, localOrientation, false);
      if (big) result.big = await Bun.file(bigPath).bytes().then((b) => Buffer.from(b));
    } else {
      icc = KEEP_ICC ? await iccOf(input) : undefined;
      big = await orient(await decode(file, input, heightOf(BIG)), localOrientation);
      result.big = await encodeWebp(big, WEBP_Q, BIG_EFFORT, icc);
      await writeFile(bigPath, result.big);
    }
  }
  const smaller = dirs.filter((d) => d !== BIG);
  if (!smaller.length) return result;
  if (!big) {
    // From bytes: on Windows a file libvips has opened stays open.
    const bytes = result.big ?? Buffer.from(await Bun.file(bigPath).bytes());
    icc = KEEP_ICC ? await iccOf(bytes) : undefined;
    big = await decodePixels(bytes);
  }
  for (const dir of smaller) {
    const small = await shrinkPixels(big, heightOf(dir));
    const webp = await encodeWebp(small, SMALL_Q, SMALL_EFFORT, icc);
    await writeFile(thumbPath(dir, hash, ".webp"), webp);
    if (dir === SQUARE_SMALL) result.small = webp;
  }
  return result;
}

/** render_big_thumbnail_to: the big thumbnail written to `out` (to compare a changed file with the index). */
export async function renderBigTo(file: string, out: string, localOrientation: number, legacy: boolean) {
  if (isRaw(file)) {
    await rawBig(file, out, localOrientation, legacy);
    return;
  }
  const p = await orient(await decode(file, file, heightOf(BIG)), localOrientation);
  await writeFile(out, await encodeWebp(p, WEBP_Q, legacy ? null : BIG_EFFORT, KEEP_ICC ? await iccOf(file) : undefined));
}

// ---- video --------------------------------------------------------------------

async function runFfmpeg(args: string[], output: string) {
  ensureDirOf(output);
  const proc = Bun.spawn([config.ffmpeg, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, FFMPEG_TIMEOUT_MS);
  const [, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (timedOut) {
    rmSync(output, { force: true });
    throw new Error(`ffmpeg did not finish within ${FFMPEG_TIMEOUT_MS / 1000} s: no output`);
  }
  if (code !== 0) {
    rmSync(output, { force: true });
    throw new Error(`ffmpeg exited with status ${code}: ${tail(err)}`);
  }
}

async function transferCharacteristics(input: string): Promise<string> {
  try {
    const proc = Bun.spawn(
      [config.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "json", input],
      { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => proc.kill(), 30_000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    const v = JSON.parse(out) as { streams?: { color_transfer?: string }[] };
    return v.streams?.[0]?.color_transfer ?? "";
  } catch {
    return "";
  }
}

let zscale: Promise<boolean> | null = null;
function supportsZscale(): Promise<boolean> {
  zscale ??= (async () => {
    try {
      const proc = Bun.spawn([config.ffmpeg, "-hide_banner", "-filters"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
      const out = await new Response(proc.stdout).text();
      return out.split("\n").some((l) => l.trim().split(/\s+/)[1] === "zscale");
    } catch {
      return false;
    }
  })();
  return zscale;
}

/** video_color.video_filter: the caller's scale, then a tonemap for PQ/HLG sources. */
async function videoFilter(input: string, scale: string | null): Promise<string | null> {
  const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
  const steps = scale ? [scale] : [];
  const transfer = await transferCharacteristics(input);
  if (transfer === "smpte2084" || transfer === "arib-std-b67") steps.push((await supportsZscale()) ? TONEMAP : "format=yuv420p");
  return steps.length ? steps.join(",") : null;
}

/** create_thumbnail_for_video: the first frame as the big WebP. */
export async function videoBig(input: string, hash: string) {
  const output = thumbPath(BIG, hash, ".webp");
  const cmd = ["-y", "-i", input, "-ss", "00:00:00.000", "-vframes", "1", ...NO_METADATA];
  const f = await videoFilter(input, null);
  if (f) cmd.push("-filter:v", f);
  cmd.push(output);
  await runFfmpeg(cmd, output);
}

/** create_animated_thumbnail: 5 s of H.264, scale=-2:<height>. */
export async function videoAnimated(input: string, hash: string, dir: string) {
  const output = thumbPath(dir, hash, ".mp4");
  const filter = (await videoFilter(input, `scale=-2:${heightOf(dir)}`)) ?? "";
  await runFfmpeg(["-y", "-i", input, "-to", "00:00:05", "-vcodec", "libx264", "-crf", "20", "-an", ...NO_METADATA, "-filter:v", filter, output], output);
}
