// strip_thumbnail_metadata (port of lp-ingest thumbnail_metadata.rs;
// api/thumbnail_metadata.py, Django #2140): remove the original's EXIF/XMP
// from WebP thumbnails and a video's metadata from MP4 thumbnails written
// before they were left out. Only the container changes, never the encoded
// picture; the ICC profile is kept. Only files that still carry metadata
// are rewritten.
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BIG, SQUARE, SQUARE_SMALL } from "./render";

export const THUMBNAIL_DIRS = [BIG, SQUARE, SQUARE_SMALL];
const METADATA_CHUNKS = new Set(["EXIF", "XMP "]);
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;
const BATCH_SIZE = 500;
const MP4_METADATA_GROUPS = ["-UserData:all", "-ItemList:all", "-Keys:all", "-XMP:all"];
const HARMLESS_MP4_TAGS = new Set(["SourceFile", "ItemList:Encoder"]);

export interface StripResult {
  scanned: number;
  withMetadata: string[];
  stripped: number;
  stillWithMetadata: string[];
  errors: string[];
}

/** The RIFF chunks of a WebP as [fourcc, start, end], or null when it is not one. */
function webpChunks(data: Buffer): [string, number, number][] | null {
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WEBP") return null;
  const end = Math.min(data.length, 8 + data.readUInt32LE(4));
  const chunks: [string, number, number][] = [];
  for (let pos = 12; pos + 8 <= end; ) {
    const size = data.readUInt32LE(pos + 4);
    const chunkEnd = pos + 8 + size + (size & 1);
    chunks.push([data.toString("latin1", pos, pos + 4), pos, Math.min(chunkEnd, data.length)]);
    pos = chunkEnd;
  }
  return chunks;
}

export const webpHasMetadata = (p: string) => (webpChunks(readFileSync(p)) ?? []).some(([c]) => METADATA_CHUNKS.has(c));

/** The WebP without its EXIF and XMP chunks (VP8X flags cleared), or null when it has none. */
export function webpWithoutMetadata(data: Buffer): Buffer | null {
  const chunks = webpChunks(data);
  if (!chunks || !chunks.some(([c]) => METADATA_CHUNKS.has(c))) return null;
  const parts: Buffer[] = [Buffer.from("WEBP", "latin1")];
  for (const [c, s, e] of chunks) {
    if (METADATA_CHUNKS.has(c)) continue;
    const piece = Buffer.from(data.subarray(s, e));
    if (c === "VP8X" && piece.length > 8) piece[8] &= ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
    parts.push(piece);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Drop the EXIF and XMP chunks of the WebP at `p` (replaced atomically); whether it changed. */
export function stripWebpMetadata(p: string): boolean {
  const stripped = webpWithoutMetadata(readFileSync(p));
  if (!stripped) return false;
  const tmp = `${p}.${crypto.randomUUID()}.tmp`;
  writeFileSync(tmp, stripped);
  renameSync(tmp, p);
  return true;
}

async function exiftool(exe: string, args: string[], paths: string[]) {
  const argfile = path.join(tmpdir(), `lp-ts-${crypto.randomUUID()}.args`);
  writeFileSync(argfile, paths.map((p) => `${p}\n`).join(""));
  try {
    const proc = Bun.spawn([exe, "-charset", "filename=utf8", ...args, "-@", argfile], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, code };
  } finally {
    rmSync(argfile, { force: true });
  }
}

const normpath = (p: string) => (process.platform === "win32" ? p.replaceAll("/", "\\") : p);

/** The video thumbnails in `paths` that carry metadata from their source. */
export async function mp4sWithMetadata(exe: string, paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const out = await exiftool(exe, ["-j", "-G1", "-a", ...MP4_METADATA_GROUPS], paths.slice(i, i + BATCH_SIZE));
    const entries = JSON.parse(out.stdout.trim() || "[]") as Record<string, unknown>[];
    for (const e of entries) {
      // ExifTool:Error / Warning describe the file, they are not in it.
      const dirty = Object.keys(e).some((t) => !t.startsWith("ExifTool:") && !HARMLESS_MP4_TAGS.has(t));
      if (dirty && typeof e.SourceFile === "string") found.push(normpath(e.SourceFile));
    }
  }
  return found;
}

async function stripMp4s(exe: string, paths: string[], errors: string[]) {
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    try {
      const out = await exiftool(exe, ["-overwrite_original", "-q", "-q", "-all="], paths.slice(i, i + BATCH_SIZE));
      if (out.code !== 0) errors.push(out.stderr.trim() || `exiftool exit ${out.code}`);
    } catch (e) {
      errors.push(`exiftool: ${e}`);
    }
  }
}

/** Every .webp and .mp4 directly in the three thumbnail directories. */
export function thumbnailFiles(mediaRoot: string): [string[], string[]] {
  const webps: string[] = [];
  const mp4s: string[] = [];
  for (const dir of THUMBNAIL_DIRS) {
    let names: string[];
    try {
      names = readdirSync(path.join(mediaRoot, dir));
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(mediaRoot, dir, n);
      try {
        if (!statSync(p).isFile()) continue;
      } catch {
        continue;
      }
      const ext = path.extname(n).toLowerCase();
      if (ext === ".webp") webps.push(p);
      else if (ext === ".mp4") mp4s.push(p);
    }
  }
  return [webps, mp4s];
}

function eachWebp(paths: string[], action: (p: string) => boolean, errors: string[], progress: (m: string) => void): string[] {
  const found: string[] = [];
  paths.forEach((p, i) => {
    try {
      if (action(p)) found.push(p);
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
    if ((i + 1) % 10_000 === 0) progress(`${i + 1}/${paths.length} WebP thumbnails done`);
  });
  return found;
}

/** Remove EXIF, XMP and video metadata from every thumbnail under `mediaRoot`. */
export async function stripThumbnailMetadata(mediaRoot: string, exe: string, dryRun: boolean, progress: (m: string) => void = () => {}): Promise<StripResult> {
  const result: StripResult = { scanned: 0, withMetadata: [], stripped: 0, stillWithMetadata: [], errors: [] };
  const [webps, mp4s] = thumbnailFiles(mediaRoot);
  result.scanned = webps.length + mp4s.length;
  let dirtyMp4s: string[] = [];
  if (mp4s.length) {
    try {
      dirtyMp4s = await mp4sWithMetadata(exe, mp4s);
    } catch (e) {
      result.errors.push(`exiftool: ${e}`);
    }
  }
  if (dryRun) {
    result.withMetadata = [...eachWebp(webps, webpHasMetadata, result.errors, progress), ...dirtyMp4s];
    return result;
  }
  const stripped = eachWebp(webps, stripWebpMetadata, result.errors, progress);
  await stripMp4s(exe, dirtyMp4s, result.errors);
  // Counted from what is on disk afterwards, not from what the tools report.
  const left = eachWebp(stripped, webpHasMetadata, result.errors, () => {});
  if (dirtyMp4s.length) {
    try {
      left.push(...(await mp4sWithMetadata(exe, dirtyMp4s)));
    } catch (e) {
      result.errors.push(`exiftool: ${e}`);
    }
  }
  result.withMetadata = [...stripped, ...dirtyMp4s];
  result.stripped = result.withMetadata.length - left.length;
  result.stillWithMetadata = left;
  return result;
}
