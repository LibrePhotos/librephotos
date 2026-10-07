// One file group -> one Photo (port of lp-ingest pipeline.rs;
// file_handlers.py): File rows, grouping, replaced-file re-keying, motion
// photos, then _process_photo (thumbnails, aspect ratio, pHash, EXIF,
// screenshot flag, date + day album, dominant colour, search text).
//
// Each file is read into memory once: the bytes feed the content sniff, the
// MD5, the motion-photo search and the libvips decode. Videos above
// STREAM_ABOVE are hashed streaming instead and never held.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { exif } from "../../lib/exif";
import { siteSettings } from "../../lib/settings";
import * as dates from "./dates";
import * as db from "./db";
import { begin, type FileRow, type PhotoRow, type Q } from "./db";
import { EXIF_TAGS, metadataUpdate, photoUpdate, type ExifValues } from "./exifmap";
import * as fsu from "./fsutil";
import { hashPixels } from "./hashPool";
import { listRepr, pyRound2 } from "./pyfmt";
import * as render from "./render";
import { BIG, SQUARE, SQUARE_SMALL, STATIC_DIRS, storedName, thumbPath } from "./render";

/** What the pipeline needs about the owner, loaded once per job. */
export interface Owner {
  id: number;
  rules: dates.Rule[];
  defaultTimezone: string;
  scanDirectory: string;
}

export async function loadOwner(userId: number): Promise<Owner | null> {
  const r = await client`SELECT id, datetime_rules, default_timezone, scan_directory FROM api_user WHERE id = ${userId}`;
  if (!r.length) return null;
  return { id: r[0].id, rules: dates.rulesFromUser(r[0].datetime_rules), defaultTimezone: r[0].default_timezone, scanDirectory: r[0].scan_directory };
}

const STREAM_ABOVE = 256 * 1024 * 1024;
const embeddedMediaDir = () => path.join(config.mediaRoot, "embedded_media");
const transcodedDir = () => path.join(config.mediaRoot, "transcoded");

/** A file read for the group: its bytes (null for a huge video) and first 8 KiB. */
interface Loaded {
  bytes: Uint8Array | null;
  head: Uint8Array | null;
}

async function load(p: string): Promise<Loaded> {
  let size = 0;
  try {
    size = statSync(p).size;
  } catch {
    return { bytes: null, head: null };
  }
  if (size > STREAM_ABOVE) return { bytes: null, head: fsu.readHead(p) };
  try {
    const bytes = await Bun.file(p).bytes();
    return { bytes, head: bytes.subarray(0, 8192) };
  } catch {
    return { bytes: null, head: null };
  }
}

async function md5File(p: string, userId: number): Promise<string> {
  const h = createHash("md5");
  for await (const chunk of Bun.file(p).stream()) h.update(chunk);
  return h.digest("hex") + String(userId);
}

const hashOf = async (p: string, l: Loaded, userId: number) => (l.bytes ? fsu.hashBytes(l.bytes, userId) : md5File(p, userId));

interface Probe {
  valid: boolean;
  kind: number;
}

/** is_valid_media + detect_file_type. */
async function probe(p: string, l: Loaded): Promise<Probe> {
  const sniffed = l.head ? fsu.sniffMimeHead(l.head) : null;
  const isVideo = !!sniffed && sniffed.includes("video");
  let valid: boolean;
  if (isVideo) valid = config.features.video;
  else if (fsu.isMetadata(p) || fsu.isRaw(p)) valid = true;
  else valid = l.bytes ? await render.canDecode(l.bytes, sniffed) : !!sniffed?.startsWith("image/");
  let kind = fsu.IMAGE;
  if (fsu.isRaw(p)) kind = fsu.RAW_FILE;
  if (isVideo) kind = fsu.VIDEO;
  if (fsu.isMetadata(p)) kind = fsu.METADATA_FILE;
  return { valid, kind };
}

const MOTION_SIGNATURES = ["ftypmp42", "ftypisom", "ftypiso2"].map((s) => Buffer.from(s, "latin1"));
const SAMSUNG_MOTION = Buffer.from("MotionPhoto_Data", "latin1");

/** Where an embedded motion video starts (_locate_google_embedded_video by signature priority, then Samsung's marker). */
export function motionVideoOffset(data: Uint8Array): number | null {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (const sig of MOTION_SIGNATURES) {
    const i = b.indexOf(sig);
    if (i >= 0) return Math.max(0, i - 4);
  }
  const s = b.indexOf(SAMSUNG_MOTION);
  return s >= 0 ? s + SAMSUNG_MOTION.length : null;
}

/** Per group: files read once, by path. */
export type Loads = Map<string, Loaded>;

async function loaded(loads: Loads, p: string): Promise<Loaded> {
  let l = loads.get(p);
  if (!l) {
    l = await load(p);
    loads.set(p, l);
  }
  return l;
}

/** create_file_record. */
async function createFileRecord(owner: Owner, p: string, loads: Loads): Promise<FileRow | null> {
  const l = await loaded(loads, p);
  const pr = await probe(p, l);
  if (!pr.valid) {
    console.info(`not valid media: ${p}`);
    return null;
  }
  let hash: string;
  try {
    hash = await hashOf(p, l, owner.id);
  } catch {
    throw new Error(`Could not calculate hash for file ${p}`);
  }
  if (await db.isEmbeddedMedia(client, hash)) {
    console.warn(`embedded content file found: ${p}`);
    return null;
  }
  await reindexReplaced(owner, p, hash);
  return db.fileCreate(client, p, hash, pr.kind, () => fsu.exists(p));
}

/** File.create(path, user) for a path whose hash is not known yet. */
async function fileCreatePath(q: Q, owner: number, p: string): Promise<FileRow> {
  const f = await db.fileByPath(q, p);
  if (f) {
    if (f.missing && fsu.exists(p)) return db.fileCreate(q, f.path, f.hash, f.type, () => true);
    return f;
  }
  const l = await load(p);
  const pr = await probe(p, l);
  let hash: string;
  try {
    hash = await hashOf(p, l, owner);
  } catch {
    throw new Error(`Could not calculate hash for file ${p}`);
  }
  return db.fileCreate(q, p, hash, pr.kind, () => fsu.exists(p));
}

export type GroupOutcome = { ok: true; photo: string | null } | { ok: false; error: string };

/** handle_file_group: the photo, null for a skipped group of non-media files, or the error text recorded on the job. */
export async function handleFileGroup(owner: Owner, paths: string[]): Promise<GroupOutcome> {
  const loads: Loads = new Map();
  try {
    const files: FileRow[] = [];
    for (const p of paths) {
      const f = await createFileRecord(owner, p, loads);
      if (f) files.push(f);
    }
    if (!files.length) {
      // Only a group with something that looks like media is a failure;
      // unrelated files (RawTherapee .pp3, notes) are skipped.
      if (!paths.some(fsu.looksLikeMedia)) {
        console.info(`ignoring non-media files: ${listRepr(paths)}`);
        return { ok: true, photo: null };
      }
      const msg = `No valid files in group: ${listRepr(paths)}`;
      console.warn(msg);
      return { ok: false, error: msg };
    }
    const photo = await groupFilesIntoPhoto(owner, files, loads);
    if (!photo) {
      const msg = `Could not create photo for files: ${listRepr(paths)}`;
      console.warn(msg);
      return { ok: false, error: msg };
    }
    if (photo.main_file_id) await processPhoto(owner, photo.id, loads);
    return { ok: true, photo: photo.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`could not process file group ${JSON.stringify(paths)}: ${msg}`);
    return { ok: false, error: `${paths.join(", ")}: ${msg}` };
  }
}

/** group_files_into_photo. */
async function groupFilesIntoPhoto(owner: Owner, files: FileRow[], loads: Loads): Promise<PhotoRow | null> {
  const nonMeta = files.filter((f) => f.type !== fsu.METADATA_FILE);
  if (!nonMeta.length) {
    console.warn("only metadata files in group, skipping");
    return null;
  }
  const main = nonMeta.reduce((a, b) => {
    const pa = fsu.typePriority(a.type);
    const pb = fsu.typePriority(b.type);
    return pb < pa || (pb === pa && b.path < a.path) ? b : a;
  });
  const hashes = nonMeta.map((f) => f.hash);
  const result = await begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(7340032, hashtext(${main.hash}))`;
    const existing = await db.findPhotoWithFiles(tx, owner.id, hashes);
    if (existing) {
      for (const f of files) await db.addPhotoFile(tx, existing.id, f.hash);
      const out = { ...existing };
      if (existing.main_file_id) {
        const curType = (await db.fileType(tx, existing.main_file_id)) ?? 999;
        if (fsu.typePriority(main.type) < fsu.typePriority(curType)) {
          await db.setMainFile(tx, existing.id, main.hash);
          out.main_file_id = main.hash;
        }
      }
      return { photo: out, fresh: false };
    }
    const photo = await db.insertPhoto(tx, owner.id, main.hash, main.hash, main.type === fsu.VIDEO);
    for (const f of files) await db.addPhotoFile(tx, photo.id, f.hash);
    return { photo, fresh: true };
  });
  if (result.fresh) await attachMotion(owner, result.photo.id, main, loads);
  return result.photo;
}

/** _attach_embedded_motion_video. */
export async function attachMotion(owner: Owner, photo: string, file: FileRow, loads?: Loads) {
  const f = config.features;
  if (!(f.processEmbeddedMedia && f.video)) return;
  const l = loads ? await loaded(loads, file.path) : await load(file.path);
  if (fsu.mimeTypeOf(file.path, l.head) !== "image/jpeg") return;
  const data = l.bytes ?? (await Bun.file(file.path).bytes());
  const pos = motionVideoOffset(data);
  if (pos === null) return;
  const dir = embeddedMediaDir();
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${file.hash}_motion.mp4`);
  await Bun.write(out, data.subarray(pos));
  await begin(async (tx) => {
    const em = await fileCreatePath(tx, owner.id, out);
    await db.linkEmbedded(tx, file.hash, em.hash);
    await db.addPhotoFile(tx, photo, em.hash);
    await db.touchPhoto(tx, photo);
  });
}

// ---- _process_photo ----------------------------------------------------------


async function phashOf(webp: Uint8Array): Promise<string | null> {
  try {
    const px = await render.decodePixels(webp);
    return await hashPixels("phash", px.data, px.width, px.height, px.channels);
  } catch {
    return null;
  }
}

async function dominantOf(webp: Uint8Array): Promise<string | null> {
  try {
    const px = await render.decodePixels(webp);
    return await hashPixels("dominant", px.data, px.width, px.height, px.channels);
  } catch {
    return null;
  }
}

const readIfExists = async (p: string): Promise<Uint8Array | null> => (render.fileExists(p) ? Bun.file(p).bytes() : null);

/** Aspect ratio as the scanner stores it: round(w / h, 2). */
export async function aspectOf(webp: Uint8Array | null, file: string): Promise<number | null> {
  const size = (webp && render.webpSize(webp)) || (await render.imageSize(file));
  if (!size || !size[0] || !size[1]) return null;
  return pyRound2(size[0] / size[1]);
}

/** _process_photo. */
export async function processPhoto(owner: Owner, photoId: string, loads?: Loads) {
  const photo = await db.photoById(client, photoId);
  if (!photo) throw new Error(`photo ${photoId} vanished`);
  if (!photo.main_file_id) return;
  const main = await db.fileByHash(client, photo.main_file_id);
  if (!main) throw new Error(`main file ${photo.main_file_id} vanished`);
  const thumb = await db.ensureThumbnail(client, photo.id);
  const mainPath = main.path;

  // One ExifTool request per photo: every tag the metadata and the datetime
  // rules need, fetched while the thumbnails render.
  const tags = [...EXIF_TAGS];
  for (const t of dates.requiredTags(owner.rules)) if (!tags.includes(t)) tags.push(t);
  const exifTask = exif.getMetadata(mainPath, tags, true, false);
  exifTask.catch(() => {});

  const hash = photo.image_hash;
  const rendered = await generateThumbnails(photo, mainPath, loads);
  const ext = photo.video ? ".mp4" : ".webp";
  const bigPath = thumbPath(BIG, hash, ".webp");
  const smallPath = thumbPath(SQUARE_SMALL, hash, ext);
  const wantColor = !thumb.dominant_color && !photo.video;
  const bigBytes = rendered.big ?? (await readIfExists(bigPath));
  const aspect = await aspectOf(bigBytes, bigPath);
  const phash = bigBytes ? await phashOf(bigBytes) : null;
  let dominant: string | null = null;
  if (wantColor) {
    const small = rendered.small ?? (await readIfExists(smallPath));
    if (small) dominant = await dominantOf(small);
  }
  await begin(async (tx) => {
    await db.writeThumbnail(tx, photo.id, {
      big: storedName(BIG, hash, ".webp"),
      square: storedName(SQUARE, hash, ext),
      small: storedName(SQUARE_SMALL, hash, ext),
      aspectRatio: aspect,
    });
    if (phash) await db.setPerceptualHash(tx, photo.id, phash);
  });

  const values = await exifTask;
  const byTag: ExifValues = new Map(tags.map((t, i) => [t, values[i]]));
  const pu = photoUpdate(byTag);
  const mu = metadataUpdate(byTag);
  const taggingModel = (await siteSettings()).TAGGING_MODEL;
  await begin(async (tx) => {
    const meta = await db.upsertMetadata(tx, photo.id, mu);
    if (meta.keywords != null) await db.linkTags(tx, owner.id, photo.id, meta.keywords);
    if (mu.description !== null) await db.importDescription(tx, owner.id, photo.id, photo.image_hash, mu.description);
    const isScreenshot = photo.category_source !== "user" ? classifyScreenshot(main.path, photo, meta) : null;
    const exifTs = dates.extractLocalDateTime(mainPath, owner.rules, byTag, {
      gpsLat: photo.exif_gps_lat,
      gpsLon: photo.exif_gps_lon,
      userDefaultTz: owner.defaultTimezone,
      userDefinedTimestamp: photo.timestamp,
    });
    await db.moveToAlbumDate(tx, owner.id, photo.id, photo.image_hash, photo.exif_timestamp, exifTs);
    await db.savePhotoScanFields(tx, photo.id, pu, isScreenshot, exifTs);
    if (dominant) {
      await tx`UPDATE api_thumbnail SET dominant_color = ${dominant} WHERE photo_id = ${photo.id}::uuid
        AND (dominant_color IS NULL OR dominant_color = '')`;
    }
    await db.recreateSearch(tx, photo.id, taggingModel);
  });
}

/** Thumbnail._generate_thumbnail: only what is missing on disk. */
async function generateThumbnails(photo: PhotoRow, mainPath: string, loads?: Loads): Promise<render.StaticResult> {
  const hash = photo.image_hash;
  if (!photo.video) {
    const missing = STATIC_DIRS.filter((d) => !render.fileExists(thumbPath(d, hash, ".webp")));
    if (!missing.length) return { big: null, small: null };
    const l = loads ? await loaded(loads, mainPath) : await load(mainPath);
    try {
      return await render.staticThumbnails(mainPath, l.bytes ?? mainPath, hash, missing, photo.local_orientation);
    } catch (e) {
      throw new Error(`could not generate thumbnail for image ${mainPath}: ${(e as Error).message}`);
    }
  }
  if (!render.fileExists(thumbPath(BIG, hash, ".webp"))) await render.videoBig(mainPath, hash);
  for (const dir of [SQUARE, SQUARE_SMALL]) {
    if (!render.fileExists(thumbPath(dir, hash, ".mp4"))) await render.videoAnimated(mainPath, hash, dir);
  }
  return { big: null, small: null };
}

/** Thumbnail._regenerate_thumbnails: delete, render, aspect ratio, pHash. */
export async function regenerateThumbnails(photoId: string) {
  const photo = await db.photoById(client, photoId);
  if (!photo) throw new Error(`photo ${photoId} vanished`);
  if (!photo.main_file_id) return;
  const main = await db.fileByHash(client, photo.main_file_id);
  if (!main) throw new Error("main file vanished");
  await db.ensureThumbnail(client, photo.id);
  deleteThumbnailFiles(photo.image_hash);
  const rendered = await generateThumbnails(photo, main.path);
  const hash = photo.image_hash;
  const ext = photo.video ? ".mp4" : ".webp";
  const bigPath = thumbPath(BIG, hash, ".webp");
  const big = rendered.big ?? (await readIfExists(bigPath));
  const aspect = await aspectOf(big, bigPath);
  const ph = big ? await phashOf(big) : null;
  await begin(async (tx) => {
    await db.writeThumbnail(tx, photo.id, {
      big: storedName(BIG, hash, ".webp"),
      square: storedName(SQUARE, hash, ext),
      small: storedName(SQUARE_SMALL, hash, ext),
      aspectRatio: aspect,
    });
    if (ph) await db.setPerceptualHash(tx, photo.id, ph);
  });
}

const THUMB_FILES: [string, string][] = [
  [BIG, ".webp"],
  [SQUARE, ".webp"],
  [SQUARE_SMALL, ".webp"],
  [SQUARE, ".mp4"],
  [SQUARE_SMALL, ".mp4"],
];

/** delete_thumbnail_files. */
export function deleteThumbnailFiles(hash: string) {
  for (const [dir, ext] of THUMB_FILES) {
    const p = thumbPath(dir, hash, ext);
    try {
      rmSync(p, { force: true });
    } catch (e) {
      console.error(`could not remove thumbnail ${p}: ${e}`);
    }
  }
}

// ---- replaced files ----------------------------------------------------------

/** Files to delete once the transaction committed (best effort). */
export class AfterCommit {
  private files: string[] = [];
  deleteFile(p: string) {
    this.files.push(p);
  }
  run() {
    for (const f of this.files) {
      try {
        rmSync(f, { force: true });
      } catch (e) {
        console.warn(`after-commit delete of ${f} failed: ${e}`);
      }
    }
  }
}

type Verdict = "same" | "new" | "uncomparable";

/** The pHash `p` would get as a big thumbnail (null when not comparable). */
async function renderedPhash(p: string, localOrientation: number, legacy: boolean): Promise<string | null> {
  if (fsu.isVideo(p)) return null;
  const dir = path.join(tmpdir(), `lp-ts-cmp-${crypto.randomUUID()}`);
  const out = path.join(dir, "candidate.webp");
  try {
    mkdirSync(dir, { recursive: true });
    await render.renderBigTo(p, out, localOrientation, legacy);
    return await phashOf(await Bun.file(out).bytes());
  } catch (e) {
    console.error(`could not render ${p} to compare it with the index: ${(e as Error).message}`);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function pictureVerdict(photo: PhotoRow | undefined, p: string): Promise<Verdict> {
  const stored = photo?.perceptual_hash;
  if (!photo || !stored) return "uncomparable";
  if (photo.local_orientation !== 1) return "uncomparable";
  const candidate = await renderedPhash(p, photo.local_orientation, false);
  if (candidate === stored) return "same";
  const legacy = await renderedPhash(p, photo.local_orientation, true);
  if (legacy === stored) return "same";
  if (candidate === null || legacy === null) return "uncomparable";
  return "new";
}

/** reindex_replaced_file: re-point `p`'s rows at its new content. */
export async function reindexReplaced(owner: Owner, p: string, newHash: string): Promise<string | null> {
  const existing = await db.fileByPath(client, p);
  if (!existing) return null;
  const md5 = (h: string) => h.slice(0, 32);
  const ownerPart = (h: string) => h.slice(32);
  if (md5(existing.hash) === md5(newHash)) return null;
  if (ownerPart(existing.hash) !== ownerPart(newHash)) {
    console.info(`${p}: indexed under another user's hash, leaving it to their scan`);
    return null;
  }
  if (await db.fileByHash(client, newHash)) {
    console.error(`${p}: changed file matches an already indexed file, not re-indexing`);
    return null;
  }
  const old = existing.hash;
  const affected: PhotoRow[] = (
    await client.unsafe(
      `SELECT ${db.PHOTO_COLS} FROM api_photo p WHERE NOT p.removed AND (
         EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id AND pf.file_id = $1)
         OR p.main_file_id = $1 OR (p.image_hash = $1 AND p.main_file_id IS NOT NULL)) ORDER BY p.id`,
      [old],
    )
  ).map(db.toPhoto);
  const mainIds = new Set(affected.filter((x) => x.main_file_id === old).map((x) => x.id));
  const scanned = affected.find((x) => x.owner_id === owner.id && x.image_hash === old);
  const compare = scanned?.perceptual_hash ? scanned : (affected.find((x) => x.image_hash === old && !!x.perceptual_hash) ?? scanned);
  const verdict = await pictureVerdict(compare, p);
  console.info(`${p}: content changed (${verdict}), re-keying to ${newHash}`);

  const after = new AfterCommit();
  const rebuild: string[] = [];
  let mainPhoto: string | null = null;
  await begin(async (tx) => {
    if (verdict === "new") await discardEmbeddedMedia(tx, old, after);
    await rekeyFile(tx, existing, newHash, fsu.detectFileType(p));
    for (const ph of affected) {
      if (mainIds.has(ph.id) && ph.owner_id === owner.id) mainPhoto = ph.id;
      if (verdict === "same" || ph.image_hash !== old) continue;
      after.deleteFile(path.join(transcodedDir(), `${old}.mp4`));
      await tx`UPDATE api_thumbnail SET dominant_color = NULL WHERE photo_id = ${ph.id}::uuid`;
      if (verdict === "uncomparable") {
        rebuild.push(ph.id);
        continue;
      }
      await discardFaces(tx, ph.id, after);
      for (const [dir, ext] of THUMB_FILES) after.deleteFile(thumbPath(dir, old, ext));
      await tx`UPDATE api_photo SET image_hash = ${newHash}, added_on = now(), last_modified = now() WHERE id = ${ph.id}::uuid`;
      rebuild.push(ph.id);
    }
  });
  after.run();
  for (const id of rebuild) {
    try {
      await regenerateThumbnails(id);
    } catch (e) {
      console.warn(`could not regenerate thumbnails of ${id}: ${(e as Error).message}`);
    }
  }
  if (verdict === "new" && mainPhoto) {
    await attachMotion(owner, mainPhoto, { hash: newHash, path: p, type: existing.type, missing: existing.missing });
  }
  return mainPhoto;
}

/** File.rekey: a new row under `newHash`, relations carried across. */
async function rekeyFile(tx: Q, old: FileRow, newHash: string, kind: number) {
  const variantOf: string[] = (await tx`SELECT photo_id::text AS id FROM api_photo_files WHERE file_id = ${old.hash} AND photo_id IS NOT NULL`).map((r: { id: string }) => r.id);
  const mainOf: string[] = (await tx`SELECT id::text AS id FROM api_photo WHERE main_file_id = ${old.hash}`).map((r: { id: string }) => r.id);
  const embedded: string[] = (await tx`SELECT to_file_id AS h FROM api_file_embedded_media WHERE from_file_id = ${old.hash}`).map((r: { h: string }) => r.h);
  const embeddedIn: string[] = (await tx`SELECT from_file_id AS h FROM api_file_embedded_media WHERE to_file_id = ${old.hash}`).map((r: { h: string }) => r.h);
  await tx`DELETE FROM api_photo_files WHERE file_id = ${old.hash}`;
  await tx`DELETE FROM api_file_embedded_media WHERE from_file_id = ${old.hash} OR to_file_id = ${old.hash}`;
  await tx`UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ${old.hash}`;
  await tx`DELETE FROM api_file WHERE hash = ${old.hash}`;
  await tx`INSERT INTO api_file (hash, path, type, missing) VALUES (${newHash}, ${old.path}, ${kind}, ${old.missing})`;
  for (const e of embedded) await db.linkEmbedded(tx, newHash, e);
  for (const parent of embeddedIn) await db.linkEmbedded(tx, parent, newHash);
  const seen = new Set<string>();
  for (const p of [...variantOf, ...mainOf]) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (variantOf.includes(p)) await db.addPhotoFile(tx, p, newHash);
    if (mainOf.includes(p)) await db.setMainFile(tx, p, newHash);
  }
}

/** _discard_embedded_media. */
async function discardEmbeddedMedia(tx: Q, file: string, after: AfterCommit) {
  const rows: { hash: string; path: string }[] = await tx`SELECT f.hash, f.path FROM api_file_embedded_media em
    JOIN api_file f ON f.hash = em.to_file_id WHERE em.from_file_id = ${file}`;
  for (const { hash, path: p } of rows) {
    await tx`DELETE FROM api_file_embedded_media WHERE to_file_id = ${hash} OR from_file_id = ${hash}`;
    await tx`DELETE FROM api_photo_files WHERE file_id = ${hash}`;
    await tx`UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ${hash}`;
    await tx`DELETE FROM api_file WHERE hash = ${hash}`;
    after.deleteFile(p);
  }
}

/** _discard_faces: delete the photo's faces (and crops), repair people. */
async function discardFaces(tx: Q, photo: string, after: AfterCommit) {
  const persons: { id: number }[] = await tx`SELECT DISTINCT pe.id FROM api_person pe WHERE pe.cover_photo_id = ${photo}::uuid OR pe.id IN (
      SELECT person_id FROM api_face WHERE photo_id = ${photo}::uuid AND person_id IS NOT NULL
      UNION SELECT classification_person_id FROM api_face WHERE photo_id = ${photo}::uuid AND classification_person_id IS NOT NULL
      UNION SELECT cluster_person_id FROM api_face WHERE photo_id = ${photo}::uuid AND cluster_person_id IS NOT NULL) ORDER BY pe.id`;
  const images: { image: string | null }[] = await tx`SELECT image FROM api_face WHERE photo_id = ${photo}::uuid`;
  await tx`UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN (SELECT id FROM api_face WHERE photo_id = ${photo}::uuid)`;
  await tx`DELETE FROM api_face WHERE photo_id = ${photo}::uuid`;
  for (const { image } of images) if (image) after.deleteFile(path.join(config.mediaRoot, image));
  for (const { id } of persons) {
    await tx`UPDATE api_person SET cover_photo_id = NULL, cover_face_id = NULL, last_modified = now() WHERE id = ${id} AND cover_photo_id = ${photo}::uuid`;
    await tx`UPDATE api_person pe SET face_count = (SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id
        WHERE f.person_id = pe.id AND NOT p.hidden AND NOT p.in_trashcan AND p.owner_id = pe.cluster_owner_id),
        last_modified = now() WHERE pe.id = ${id} AND pe.cluster_owner_id IS NOT NULL`;
    await tx`UPDATE api_person pe SET cover_photo_id = f.photo_id, cover_face_id = f.id, last_modified = now()
      FROM (SELECT id, photo_id FROM api_face WHERE person_id = ${id} ORDER BY id LIMIT 1) f
      WHERE pe.id = ${id} AND pe.cover_photo_id IS NULL`;
  }
}

// ---- screenshot detection ------------------------------------------------------

const SCREENSHOT_PREFIXES = ["screenshot", "screen shot", "bildschirmfoto", "captura de pantalla", "capture d'ecran", "снимок экрана", "スクリーンショット"];

const normalize = (t: string) => t.toLowerCase().replaceAll("’", "'").replace(/[_-]/g, " ");

function matchesScreenshotPrefix(base: string): boolean {
  const n = normalize(base);
  return SCREENSHOT_PREFIXES.some((p) => {
    if (!n.startsWith(p)) return false;
    const next = [...n.slice(p.length)][0];
    return next === undefined || !/\p{Alphabetic}/u.test(next);
  });
}

function inScreenshotsDir(p: string): boolean {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.slice(0, -1).some((x) => x.toLowerCase() === "screenshots");
}

/** api.screenshot_detection.classify. */
function classifyScreenshot(p: string, photo: PhotoRow, meta: db.MetaRow): boolean {
  if (p && (matchesScreenshotPrefix(fsu.fileName(p)) || inScreenshotsDir(p))) return true;
  if (fsu.splitext(p)[1].toLowerCase() !== ".png") return false;
  if (db.hasCameraMetadata(meta)) return false;
  if (photo.exif_gps_lat !== null || photo.exif_gps_lon !== null || meta.gps_latitude !== null || meta.gps_longitude !== null) return false;
  return true;
}
