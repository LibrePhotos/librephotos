// Single-file import for uploads (port of lp-ingest upload.rs):
// create_new_image (in the request, as Django does) and the queued rest of
// import_photo's chain (handle_new_image, the device-timestamp fallback,
// follow-ups).
import { arrayLiteral, client } from "../../lib/db";
import { config } from "../../lib/config";
import { exif } from "../../lib/exif";
import { enqueueIn, JobType, wakeWorker } from "../../lib/jobs";
import * as dates from "./dates";
import * as db from "./db";
import { begin } from "./db";
import * as fsu from "./fsutil";
import { attachMotion, loadOwner, processPhoto, reindexReplaced, type Owner } from "./pipeline";
import { canDecode } from "./render";
import { attachSidecar } from "./scan";
import path from "node:path";

const JPEG_EXTENSIONS = [".jpg", ".jpeg", ".heic", ".heif", ".png", ".tiff", ".tif"];

async function ownerOf(userId: number): Promise<Owner> {
  const o = await loadOwner(userId);
  if (!o) throw new Error(`user ${userId} not found`);
  return o;
}

/** The owner's photo whose main file is <dir>/<stem><ext> for one of `exts`. */
async function photoBySibling(userId: number, p: string, exts: string[]): Promise<string | null> {
  const base = fsu.splitext(p)[0];
  const arr = arrayLiteral(exts.flatMap((e) => [`${base}${e}`, `${base}${e.toUpperCase()}`]));
  const r = await client`SELECT p.id::text AS id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id
    WHERE p.owner_id = ${userId} AND f.path = ANY(${arr}::text[]) ORDER BY array_position(${arr}::text[], f.path), p.id LIMIT 1`;
  return r[0]?.id ?? null;
}

/** is_valid_media for a file on disk. */
export async function isValidMedia(p: string): Promise<boolean> {
  const head = fsu.readHead(p);
  if (fsu.isVideoHead(head)) return config.features.video;
  if (fsu.isMetadata(p) || fsu.isRaw(p)) return true;
  return canDecode(p, head ? fsu.sniffMimeHead(head) : null);
}

/** create_new_image: the Photo for an uploaded file (null when not media, embedded content, or a sidecar). */
export async function createNewImage(userId: number, p: string): Promise<string | null> {
  const owner = await ownerOf(userId);
  const head = fsu.readHead(p);
  const isVideo = fsu.isVideoHead(head);
  if (!(await isValidMedia(p))) return null;
  const hash = await fsu.calculateHash(p, userId);
  if (await db.isEmbeddedMedia(client, hash)) {
    console.warn(`embedded content file found: ${p}`);
    return null;
  }
  if (fsu.isMetadata(p)) {
    const err = await attachSidecar(owner, p);
    if (err) throw new Error(err);
    return null;
  }
  const replaced = await reindexReplaced(owner, p, hash);
  if (replaced) return replaced;
  // RAW files and Live Photo videos join the image they belong to.
  let sibling: string | null = null;
  if (fsu.isRaw(p)) sibling = await photoBySibling(userId, p, JPEG_EXTENSIONS);
  else if (isVideo && fsu.splitext(p)[1].toLowerCase() === ".mov") sibling = await photoBySibling(userId, p, [...JPEG_EXTENSIONS, ".heic"]);
  const kind = isVideo ? fsu.VIDEO : fsu.detectFileType(p, head);
  if (sibling) {
    const photo = sibling;
    await begin(async (tx) => {
      const [{ e }] = await tx`SELECT EXISTS (SELECT 1 FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id
        WHERE pf.photo_id = ${photo}::uuid AND f.path = ${p}) AS e`;
      if (e) return;
      const f = await db.fileCreate(tx, p, hash, kind, () => fsu.exists(p));
      await db.addPhotoFile(tx, photo, f.hash);
      if (isVideo) await tx`UPDATE api_photo SET video = FALSE WHERE id = ${photo}::uuid`;
      await db.touchPhoto(tx, photo);
    });
    return photo;
  }
  const { photo, file } = await begin(async (tx) => {
    const f = await db.fileCreate(tx, p, hash, kind, () => fsu.exists(p));
    const ph = await db.insertPhoto(tx, userId, hash, f.hash, isVideo);
    await db.addPhotoFile(tx, ph.id, f.hash);
    return { photo: ph, file: f };
  });
  await attachMotion(owner, photo.id, file);
  return photo.id;
}

/** import_photo's chain after create_new_image. */
export async function processUpload(userId: number, photoId: string, deviceCreatedAt: dates.Micros | null) {
  const owner = await ownerOf(userId);
  try {
    await processPhoto(owner, photoId);
  } catch (e) {
    console.error(`could not load uploaded image ${photoId}: ${(e as Error).message}`);
  }
  if (deviceCreatedAt !== null) await applyDeviceTimestampFallback(owner, photoId, deviceCreatedAt);
  const f = config.features;
  const jobs: [boolean, string, JobType][] = [
    [f.sceneClassification, "tags.generate", JobType.GenerateTags],
    [f.reverseGeocoding, "geo.locate", JobType.AddGeolocation],
    [f.faceDetection, "faces.scan", JobType.ScanFaces],
  ];
  for (const [on, kind, jt] of jobs) if (on) await enqueueUnlessQueued(kind, userId, jt);
}

/**
 * Django runs these per uploaded photo; here they are user-wide jobs that
 * pick up every photo still missing the data, so one still waiting in the
 * queue covers this photo too.
 */
async function enqueueUnlessQueued(kind: string, userId: number, jobType: JobType): Promise<boolean> {
  const queued = await begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(7340033, hashtext(${kind} || ':' || ${String(userId)}))`;
    const [{ e }] = await tx`SELECT EXISTS (SELECT 1 FROM job_queue WHERE status = 'queued' AND kind = ${kind}
      AND payload->>'user_id' = ${String(userId)}) AS e`;
    if (e) return false;
    await enqueueIn(tx, kind, { user_id: userId }, { lrj: { jobType, userId } });
    return true;
  });
  if (queued) wakeWorker();
  return queued;
}

/** apply_device_timestamp_fallback: an EXIF-less upload takes the device's capture time via the user-defined rule. */
export async function applyDeviceTimestampFallback(owner: Owner, photoId: string, ts: dates.Micros) {
  const photo = await db.photoById(client, photoId);
  if (!photo || photo.exif_timestamp !== null || !photo.main_file_id) return;
  const file = await db.fileByHash(client, photo.main_file_id);
  if (!file) return;
  const tags = dates.requiredTags(owner.rules);
  const values = await exif.getMetadata(file.path, tags, true, false);
  const byTag = new Map(tags.map((t, i) => [t, values[i]]));
  const exifTs = dates.extractLocalDateTime(file.path, owner.rules, byTag, {
    gpsLat: photo.exif_gps_lat,
    gpsLon: photo.exif_gps_lon,
    userDefaultTz: owner.defaultTimezone,
    userDefinedTimestamp: ts,
  });
  await begin(async (tx) => {
    await db.moveToAlbumDate(tx, owner.id, photo.id, photo.image_hash, photo.exif_timestamp, exifTs);
    await tx`UPDATE api_photo SET timestamp = ${dates.toPgTimestamp(ts)}::timestamptz,
        exif_timestamp = ${exifTs === null ? null : dates.toPgTimestamp(exifTs)}::timestamptz, last_modified = now()
      WHERE id = ${photo.id}::uuid`;
  });
}

/** <scan_directory>/uploads/<device>/<name>, or null for a known duplicate (UploadPhotosChunkedComplete.target_path). */
export async function targetPath(scanDirectory: string, userId: number, device: string, filename: string, imageHash: string): Promise<string | null> {
  const [{ e }] = await client`SELECT EXISTS (SELECT 1 FROM api_photo WHERE image_hash = ${imageHash}) AS e`;
  if (e) return null;
  const dir = path.join(scanDirectory, "uploads", device);
  const photoPath = path.join(dir, filename);
  if (!fsu.exists(photoPath)) return photoPath;
  if ((await fsu.calculateHash(photoPath, userId)) === imageHash) return null;
  const [stem, ext] = fsu.splitext(filename);
  return path.join(dir, `${stem}_${imageHash}${ext}`);
}
