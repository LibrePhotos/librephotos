// The in-request part of an upload's import (port of the parts of
// lp_ingest::upload the upload views call: is_valid_media, target_path,
// create_new_image). The queued rest (upload.process: thumbnails, EXIF,
// dates, follow-up jobs) is the ingest area's handler.
//
// MERGE NOTE: this is a self-contained subset of lp_ingest::upload. When the
// ingest port lands its own createNewImage (reindex of a replaced file,
// motion-photo attach, XMP sidecar attach), use that and drop this file.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "~/lib/config";
import { client } from "~/lib/db";

const IMAGE = 1;
const VIDEO = 2;
const RAW_FILE = 4;

const RAW_FORMATS = new Set(
  [".RWZ", ".CR2", ".NRW", ".EIP", ".RAF", ".ERF", ".RW2", ".NEF", ".ARW", ".K25", ".DNG", ".SRF", ".DCR", ".RAW", ".CRW", ".BAY", ".3FR", ".CS1", ".MEF", ".ORF", ".ARI", ".SR2", ".KDC", ".MOS", ".MFW", ".FFF", ".CR3", ".SRW", ".RWL", ".J6I", ".KC2", ".X3F", ".MRW", ".IIQ", ".PEF", ".CXI", ".MDC"],
);

/** os.path.splitext */
export function splitext(name: string): [string, string] {
  const base = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1;
  const file = name.slice(base);
  const lead = file.length - file.replace(/^\.+/, "").length;
  const i = file.slice(lead).lastIndexOf(".");
  return i < 0 ? [name, ""] : [name.slice(0, base + lead + i), name.slice(base + lead + i)];
}

const extUpper = (p: string) => splitext(p)[1].toUpperCase();
const isRaw = (p: string) => RAW_FORMATS.has(extUpper(p));
const isMetadata = (p: string) => extUpper(p) === ".XMP";

function head(p: string, n = 8192): Uint8Array {
  const fd = openSync(p, "r");
  try {
    const buf = new Uint8Array(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

const IMAGE_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis", "crx "]);

/** sniffed_mime(...).contains("video"): magic bytes only. */
function isVideo(p: string): boolean {
  let h: Uint8Array;
  try {
    h = head(p);
  } catch {
    return false;
  }
  const s = (a: number, b: number) => String.fromCharCode(...h.subarray(a, b));
  if (h.length >= 12 && s(4, 8) === "ftyp") return !IMAGE_BRANDS.has(s(8, 12));
  if (h.length >= 12 && s(0, 4) === "RIFF" && s(8, 12) === "AVI ") return true;
  if (h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return true; // mkv / webm
  if (h.length >= 3 && s(0, 3) === "FLV") return true;
  if (h.length >= 4 && h[0] === 0x30 && h[1] === 0x26 && h[2] === 0xb2 && h[3] === 0x75) return true; // asf / wmv
  if (h.length >= 4 && h[0] === 0 && h[1] === 0 && h[2] === 1 && (h[3] === 0xba || h[3] === 0xb3)) return true; // mpeg
  // MPEG-TS: 188-byte packets, or 192-byte M2TS ones.
  if (h.length >= 192 * 3 && ([0, 188, 376].every((i) => h[i] === 0x47) || [4, 196, 388].every((i) => h[i] === 0x47))) return true;
  return false;
}

async function canDecode(p: string): Promise<boolean> {
  try {
    const m = await sharp(p, { failOn: "none" }).metadata();
    return !!m.width && !!m.height;
  } catch {
    return false;
  }
}

/** is_valid_media for a staged upload (no extension: sniffed only). */
export async function isValidMedia(p: string): Promise<boolean> {
  if (isVideo(p)) return config.features.video;
  return isMetadata(p) || isRaw(p) || (await canDecode(p));
}

/** md5 hex of a file, streamed. */
export async function md5File(p: string): Promise<string> {
  const h = createHash("md5");
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** <scan_directory>/uploads/<device>/<name>, or null for a known duplicate (UploadPhotosChunkedComplete.target_path). */
export async function targetPath(scanDirectory: string, userId: number, device: string, filename: string, imageHash: string) {
  const [r] = await client`SELECT EXISTS (SELECT 1 FROM api_photo WHERE image_hash = ${imageHash}) AS e`;
  if (r.e) return null;
  const dir = path.join(scanDirectory, "uploads", device);
  const photoPath = path.join(dir, filename);
  if (!existsSync(photoPath)) return photoPath;
  if ((await md5File(photoPath)) + String(userId) === imageHash) return null;
  const [stem, ext] = splitext(filename);
  return path.join(dir, `${stem}_${imageHash}${ext}`);
}

const JPEG_EXTENSIONS = [".jpg", ".jpeg", ".heic", ".heif", ".png", ".tiff", ".tif"];

/**
 * create_new_image: the Photo for an uploaded file (null when the file is
 * not media, is embedded content, or is a sidecar).
 */
export async function createNewImage(userId: number, p: string): Promise<string | null> {
  const video = isVideo(p);
  const valid = video ? config.features.video : isMetadata(p) || isRaw(p) || (await canDecode(p));
  if (!valid) return null;
  const hash = (await md5File(p)) + String(userId);
  const [emb] = await client`SELECT EXISTS (SELECT 1 FROM api_file_embedded_media WHERE to_file_id = ${hash}) AS e`;
  if (emb.e) {
    console.warn(`embedded content file found: ${p}`);
    return null;
  }
  if (isMetadata(p)) return null;
  const kind = video ? VIDEO : isRaw(p) ? RAW_FILE : IMAGE;
  // RAW files and Live Photo videos join the image they belong to.
  let exts: string[] | null = null;
  if (isRaw(p)) exts = JPEG_EXTENSIONS;
  else if (video && splitext(p)[1].toLowerCase() === ".mov") exts = [...JPEG_EXTENSIONS, ".heic"];
  return client.begin(async (tx) => {
    let sibling: string | null = null;
    if (exts) {
      const base = splitext(p)[0];
      const candidates = exts.flatMap((e) => [`${base}${e}`, `${base}${e.toUpperCase()}`]);
      const lit = `{${candidates.map((c) => `"${c.replace(/[\\"]/g, (x) => "\\" + x)}"`).join(",")}}`;
      const r = await tx.unsafe(
        `SELECT p.id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id
         WHERE p.owner_id = $1 AND f.path = ANY($2::text[]) ORDER BY array_position($2::text[], f.path), p.id LIMIT 1`,
        [userId, lit],
      );
      sibling = r[0]?.id ?? null;
    }
    const fileHash = await fileCreate(tx as unknown as typeof client, p, hash, kind);
    if (sibling) {
      await tx`INSERT INTO api_photo_files (photo_id, file_id) SELECT ${sibling}::uuid, ${fileHash}
        WHERE NOT EXISTS (SELECT 1 FROM api_photo_files WHERE photo_id = ${sibling}::uuid AND file_id = ${fileHash})`;
      if (video) await tx`UPDATE api_photo SET video = FALSE WHERE id = ${sibling}::uuid`;
      await tx`UPDATE api_photo SET last_modified = now() WHERE id = ${sibling}::uuid`;
      return sibling;
    }
    const id = randomUUID();
    await tx`INSERT INTO api_photo (id, image_hash, added_on, geolocation_json, hidden, public,
        owner_id, video, rating, in_trashcan, size, main_file_id, last_modified, removed,
        local_orientation, is_screenshot, is_document, category_source)
      VALUES (${id}::uuid, ${hash}, now(), '{}', FALSE, FALSE, ${userId}, ${video}, 0, FALSE, 0, ${fileHash}, now(), FALSE,
        1, FALSE, FALSE, 'auto')`;
    await tx`INSERT INTO api_photo_files (photo_id, file_id) VALUES (${id}::uuid, ${fileHash})`;
    return id;
  });
}

/** File.create: the row for `p` (un-flagging a reappeared missing file), else a new row; on a hash collision the existing row by hash. */
async function fileCreate(tx: typeof client, p: string, hash: string, kind: number): Promise<string> {
  const [byPath] = await tx`SELECT hash, missing FROM api_file WHERE path = ${p} LIMIT 1`;
  if (byPath) {
    if (byPath.missing) await tx`UPDATE api_file SET missing = FALSE WHERE hash = ${byPath.hash}`;
    return byPath.hash;
  }
  const [moved] = await tx`UPDATE api_file SET path = ${p}, type = ${kind}, missing = FALSE WHERE hash = ${hash}
    AND NOT EXISTS (SELECT 1 FROM api_file WHERE path = ${p}) RETURNING hash`;
  if (moved) return moved.hash;
  const [ins] = await tx`INSERT INTO api_file (hash, path, type, missing) VALUES (${hash}, ${p}, ${kind}, FALSE)
    ON CONFLICT DO NOTHING RETURNING hash`;
  return ins?.hash ?? hash;
}
