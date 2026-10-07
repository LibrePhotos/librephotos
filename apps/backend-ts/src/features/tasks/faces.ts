// Faces: `faces.scan` (processing_jobs.scan_faces + photo_faces.extract_faces),
// the encoding back-fill (generate_face_embeddings), XMP face regions
// (face_extractor.extract_from_exif). Port of lp_tasks::faces + faces::xmp,
// with detection and encodings from the face service (in process or the
// face_recognition sidecar, src/ml/face).
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSharp } from "../../lib/native";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { JobType } from "../../lib/jobs";
import { siteSettings } from "../../lib/settings";
import { clusterAllFaces } from "./cluster";
import { getTags, stopExiftool } from "./exif";
import { loadPhotos, mediaPath, thumbnailPath, type TaskPhoto } from "./photos";
import { CANCEL_CHECK_EVERY, ItemCounter, begin, complete, fail, isCancelled, lastFinishedStart, setProgress, startItems } from "./run";
import { decodeRgb, type Rgb } from "../../ml/face/image";
import * as faceApi from "../../ml/face/index";
import type { FaceBox } from "./sidecars";
import type { Exec } from "./things";

/** FACE_OVERLAP_IOU_THRESHOLD. */
const FACE_OVERLAP_IOU = 0.3;
/** PIL's default JPEG quality, what save_detected_face writes crops with. */
const CROP_JPEG_QUALITY = 75;

/** calculate_iou over (top, right, bottom, left) boxes. */
export function iou(a: FaceBox, b: FaceBox): number {
  const [at, ar, ab, al] = a;
  const [bt, br, bb, bl] = b;
  const interW = Math.max(Math.min(ar, br) - Math.max(al, bl), 0);
  const interH = Math.max(Math.min(ab, bb) - Math.max(at, bt), 0);
  const inter = interW * interH;
  const union = (ab - at) * (ar - al) + (bb - bt) * (br - bl) - inter;
  return union <= 0 ? 0 : inter / union;
}

export const overlaps = (existing: FaceBox[], c: FaceBox) => existing.some((e) => iou(c, e) >= FACE_OVERLAP_IOU);

/** Face.encoding: hex of the float64 values, little endian (numpy tobytes().hex()). */
export function encodeFaceEncoding(values: number[]): string {
  const buf = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
  return buf.toString("hex");
}

export function decodeFaceEncoding(hex: string): number[] {
  const t = hex.trim();
  if (t.length % 16 !== 0 || !/^[0-9a-fA-F]*$/.test(t)) throw new Error(`bad face encoding of ${t.length / 2} bytes`);
  const buf = Buffer.from(t, "hex");
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 8) out.push(buf.readDoubleLE(i));
  return out;
}

// ------------------------------------------------------------- the scan

/**
 * `faces.scan`: detect faces on the user's photos with a thumbnail (all on a
 * full scan, else those added since the last run), then back-fill missing
 * encodings and re-cluster, each as its own job.
 */
export async function scanFaces(userId: number, fullScan: boolean, jobId: string): Promise<void> {
  const since = fullScan ? undefined : await lastFinishedStart(userId, JobType.ScanFaces, false);
  const ids: { id: string }[] =
    since === undefined
      ? await client`SELECT p.id::text AS id FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = ${userId} ORDER BY p.id`
      : await client`SELECT p.id::text AS id FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id
          WHERE p.owner_id = ${userId} AND p.added_on > ${since}::timestamptz ORDER BY p.id`;
  if (!(await startItems(jobId, ids.length))) return;
  let finished = true;
  try {
    const counter = new ItemCounter(jobId, ids.length);
    const all = ids.map((r) => r.id);
    for (let start = 0; start < all.length && finished; start += CANCEL_CHECK_EVERY) {
      const chunk = all.slice(start, start + CANCEL_CHECK_EVERY);
      if (await isCancelled(jobId)) {
        await counter.flush();
        finished = false;
        break;
      }
      const batch = await loadPhotos(chunk);
      for (const id of chunk) {
        const photo = batch.get(id);
        let error: string | null = null;
        if (photo) {
          try {
            await extractFaces(photo);
          } catch (e) {
            error = `Photo ${photo.image_hash}: ${(e as Error).message}`;
          }
        }
        await counter.done(error);
      }
    }
    if (finished) await counter.finish();
  } catch (e) {
    console.error(`scan faces failed: ${(e as Error).message}`);
    await fail(jobId, (e as Error).message);
  }
  if (!finished) return;
  // XMP regions are read: stop the idle ExifTool now (the next stage needs none).
  stopExiftool();
  await generateFaceEmbeddings(userId);
  await clusterAllFaces(userId, null);
}

interface Found {
  location: FaceBox;
  name: string | null;
  encoding: number[] | null;
}

function isFalsy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return true;
  if (Array.isArray(v)) return !v.length;
  if (typeof v === "object") return !Object.keys(v as object).length;
  return false;
}

/**
 * `extract_faces` for one photo: regions from the file's XMP, else the face
 * sidecar on the big thumbnail; new faces (IoU < 0.3 with the photo's faces)
 * are cropped to faces/ and stored; a named XMP region names an unnamed face
 * it overlaps.
 */
export async function extractFaces(photo: TaskPhoto): Promise<number> {
  if (!config.features.faceDetection) return 0;
  const big = thumbnailPath(photo);
  if (!big) throw new Error("The 'thumbnail_big' attribute has no file associated with it.");
  let image: Pixels;
  // In process the thumbnail is decoded once, like Pillow (and Rust): the
  // detector and the crops see the same pixels.
  let rgb: Rgb | null = null;
  try {
    if (faceApi.faceMode() === "inprocess") {
      rgb = await decodeRgb(await readFile(big));
      image = { data: Buffer.from(rgb.data.buffer, rgb.data.byteOffset, rgb.data.length), width: rgb.width, height: rgb.height, channels: 3 };
    } else {
      const { data, info } = await (await loadSharp())(big).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      image = { data, width: info.width, height: info.height, channels: info.channels as 3 };
    }
  } catch (e) {
    throw new Error(`${big}: ${(e as Error).message}`);
  }
  if (!photo.main_path) throw new Error("'NoneType' object has no attribute 'path'");
  const found = await findFaces(photo, big, photo.main_path, image.width, image.height, rgb);
  if (!found.length) return 0;
  return writeFaces(photo, image, found);
}

/** XMP regions of the original, else the face service on the thumbnail. */
async function findFaces(photo: TaskPhoto, big: string, main: string, width: number, height: number, pixels: Rgb | null): Promise<Found[]> {
  let found: Found[] = [];
  const values = await getTags(main, ["XMP:RegionInfo", "EXIF:Orientation"], true);
  if (values) {
    const [region, orientation] = values;
    if (!isFalsy(region)) {
      found = facesFromRegionInfo(region, orientation, width, height).map((r) => ({ location: r.location, name: r.name, encoding: null }));
    }
  }
  if (!found.length) {
    const model = (await siteSettings()).FACE_RECOGNITION_MODEL;
    try {
      const detected = pixels ? await faceApi.detectFacesRgb(pixels, model) : await faceApi.detectFaces(big, model);
      found = detected.map((f) => ({ location: f.location, name: null, encoding: f.encoding }));
    } catch (e) {
      console.error(`can't extract face information of ${photo.image_hash}: ${(e as Error).message}`);
    }
  }
  return found;
}

/** Python slice bounds (a[start:stop] on an axis of len). */
function pySlice(start: number, stop: number, len: number): [number, number] {
  const norm = (v: number) => Math.min(Math.max(v < 0 ? v + len : v, 0), len);
  const s = norm(start);
  return [s, Math.max(norm(stop), s)];
}

/** big_thumbnail_image[top:bottom, left:right] as a JPEG (PIL defaults). */
type Pixels = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

async function cropJpeg(image: Pixels, loc: FaceBox): Promise<Buffer> {
  const [top, right, bottom, left] = loc;
  const [y0, y1] = pySlice(top, bottom, image.height);
  const [x0, x1] = pySlice(left, right, image.width);
  if (y1 === y0 || x1 === x0) throw new Error(`empty face crop [${loc.join(", ")}] on a ${image.width}x${image.height} thumbnail`);
  return (await loadSharp())(image.data, { raw: { width: image.width, height: image.height, channels: image.channels } })
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .jpeg({ quality: CROP_JPEG_QUALITY })
    .toBuffer();
}

const facesDir = () => path.join(config.mediaRoot, "faces");

/** FileSystemStorage.get_available_name: faces/<name>, or with a random 7-char suffix when taken. */
function availableFaceName(fileName: string): [string, string] {
  const dir = facesDir();
  const dot = fileName.lastIndexOf(".");
  const [root, ext] = dot < 0 ? [fileName, ""] : [fileName.slice(0, dot), fileName.slice(dot)];
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let name = fileName;
  while (existsSync(path.join(dir, name))) {
    let suffix = "";
    for (let i = 0; i < 7; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    name = `${root}_${suffix}${ext}`;
  }
  return [`faces/${name}`, path.join(dir, name)];
}

async function faceBoxes(tx: Exec, photoId: string): Promise<FaceBox[]> {
  const rs: { t: number; r: number; b: number; l: number }[] = await tx`SELECT location_top AS t, location_right AS r, location_bottom AS b, location_left AS l
    FROM api_face WHERE photo_id = ${photoId} ORDER BY id`;
  return rs.map((x) => [x.t, x.r, x.b, x.l]);
}

/** Store the new faces of `found` (crops cut first, outside the transaction). */
async function writeFaces(photo: TaskPhoto, image: Pixels, found: Found[]): Promise<number> {
  const existing = await faceBoxes(client, photo.id);
  const crops: ({ stored: string; file: string } | null)[] = [];
  const written: string[] = [];
  try {
    for (let idx = 0; idx < found.length; idx++) {
      const face = found[idx];
      if (overlaps(existing, face.location)) {
        crops.push(null);
        continue;
      }
      const jpeg = await cropJpeg(image, face.location);
      const [stored, file] = availableFaceName(`${photo.image_hash}_${idx}.jpg`);
      mkdirSync(facesDir(), { recursive: true });
      await writeFile(file, jpeg);
      written.push(file);
      crops.push({ stored, file });
      existing.push(face.location);
    }
  } catch (e) {
    await removeFiles(written);
    throw e;
  }
  const unused: string[] = [];
  try {
    const saved = await client.begin(async (txn) => storeFound(txn as unknown as Exec, photo, found, crops, unused));
    await removeFiles(unused);
    return saved;
  } catch (e) {
    await removeFiles(written);
    throw e;
  }
}

async function removeFiles(paths: string[]) {
  for (const p of paths) await unlink(p).catch(() => undefined);
}

async function storeFound(
  tx: Exec,
  photo: TaskPhoto,
  found: Found[],
  crops: ({ stored: string; file: string } | null)[],
  unused: string[],
): Promise<number> {
  const unknown = await unknownCluster(tx, photo.owner_id);
  const existing = await faceBoxes(tx, photo.id);
  let saved = 0;
  for (let i = 0; i < found.length; i++) {
    const face = found[i];
    const crop = crops[i];
    const person = face.name ? await namedPerson(tx, face.name, photo.owner_id) : null;
    if (overlaps(existing, face.location)) {
      if (person !== null) await reconcileName(tx, photo.id, person, face.location);
      if (crop) unused.push(crop.file);
      continue;
    }
    // Overlapped before, not any more (a face was deleted meanwhile): no
    // crop was cut, so leave it to the next scan.
    if (!crop) continue;
    const encoding = face.encoding ? encodeFaceEncoding(face.encoding) : "";
    const [top, right, bottom, left] = face.location;
    await tx`INSERT INTO api_face (image, cluster_probability, location_top, location_bottom, location_left, location_right, encoding,
        person_id, cluster_id, classification_probability, deleted, classification_person_id, cluster_person_id, photo_id)
      VALUES (${crop.stored}, 0.0, ${top}, ${bottom}, ${left}, ${right}, ${encoding}, ${person}, ${unknown}, 0.0, FALSE, NULL, NULL, ${photo.id})`;
    if (person !== null) await refreshPerson(tx, person);
    existing.push(face.location);
    saved++;
  }
  return saved;
}

/** get_unknown_cluster: the user's cluster_id = -1 cluster, created as needed, with no person. */
export async function unknownCluster(tx: Exec, ownerId: number): Promise<number> {
  const [r] = await tx`SELECT id, person_id FROM api_cluster WHERE owner_id = ${ownerId} AND cluster_id = -1 ORDER BY id LIMIT 1`;
  if (r) {
    if (r.person_id !== null) await tx`UPDATE api_cluster SET person_id = NULL, name = 'Other Unknown Cluster' WHERE id = ${r.id}`;
    return r.id;
  }
  const [c] = await tx`INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) VALUES ('', -1, NULL, NULL, ${ownerId}) RETURNING id`;
  return c.id;
}

/** get_or_create_person(name, owner, KIND_USER) + save(). */
async function namedPerson(tx: Exec, name: string, ownerId: number): Promise<number> {
  const [r] = await tx`UPDATE api_person SET last_modified = now() WHERE id = (
      SELECT id FROM api_person WHERE name = ${name} AND cluster_owner_id = ${ownerId} AND kind = 'USER' ORDER BY id LIMIT 1) RETURNING id`;
  if (r) return r.id;
  const [c] = await tx`INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, cover_photo_id, last_modified)
    VALUES (${name}, 'USER', ${ownerId}, 0, NULL, NULL, now()) RETURNING id`;
  return c.id;
}

/** _calculate_face_count + _set_default_cover_photo (S19). */
export async function refreshPerson(tx: Exec, personId: number): Promise<void> {
  await tx`UPDATE api_person AS pe SET last_modified = now(), face_count = (
      SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id
      WHERE f.person_id = pe.id AND NOT p.hidden AND NOT p.in_trashcan AND p.owner_id = pe.cluster_owner_id)
    WHERE pe.id = ${personId}`;
  await tx`UPDATE api_person AS pe SET cover_photo_id = f.photo_id, cover_face_id = f.id, last_modified = now()
    FROM (SELECT id, photo_id FROM api_face WHERE person_id = ${personId} ORDER BY id LIMIT 1) f
    WHERE pe.id = ${personId} AND pe.cover_photo_id IS NULL`;
}

/** _reconcile_xmp_face_name: the first existing face the region overlaps takes the name when it has none. */
async function reconcileName(tx: Exec, photoId: string, personId: number, location: FaceBox): Promise<void> {
  const faces: { id: number; person_id: number | null; t: number; r: number; b: number; l: number }[] =
    await tx`SELECT id, person_id, location_top AS t, location_right AS r, location_bottom AS b, location_left AS l
      FROM api_face WHERE photo_id = ${photoId} ORDER BY id`;
  for (const f of faces) {
    if (!overlaps([[f.t, f.r, f.b, f.l]], location)) continue;
    if (f.person_id === null) {
      await tx`UPDATE api_face SET person_id = ${personId} WHERE id = ${f.id}`;
      await refreshPerson(tx, personId);
      console.warn(`XMP face reconciliation assigned person ${personId} to face ${f.id}`);
    }
    break;
  }
}

// ------------------------------------------------------------ XMP regions

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

const nonEmptyObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

/** has_normalized_area. */
function hasNormalizedArea(area: unknown, applied: unknown): boolean {
  return (nonEmptyObject(area) && area.Unit === "normalized") || (nonEmptyObject(applied) && applied.Unit === "pixel");
}

/** to_face_box: normalized centre/size to (top, right, bottom, left), after undoing the orientation, truncated like int(). */
export function toFaceBox(area: Record<string, unknown>, orientation: string | null, width: number, height: number): FaceBox | null {
  let x = asNumber(area.X);
  let y = asNumber(area.Y);
  let w = asNumber(area.W);
  let h = asNumber(area.H);
  if (x === null || y === null || w === null || h === null) return null;
  switch (orientation) {
    case "Rotate 90 CW":
    case "Mirror horizontal and rotate 270 CW":
      [x, y, w, h] = [1 - y, x, h, w];
      break;
    case "Mirror horizontal":
      x = 1 - x;
      break;
    case "Rotate 180":
      [x, y] = [1 - x, 1 - y];
      break;
    case "Mirror vertical":
      y = 1 - y;
      break;
    case "Mirror horizontal and rotate 90 CW":
    case "Rotate 270 CW":
      [x, y, w, h] = [y, 1 - x, h, w];
      break;
  }
  const halfW = (w * width) / 2;
  const halfH = (h * height) / 2;
  return [Math.trunc(y * height - halfH), Math.trunc(x * width + halfW), Math.trunc(y * height + halfH), Math.trunc(x * width - halfW)];
}

/** extract_from_exif minus the read: the Type == "Face" regions with a usable area. */
export function facesFromRegionInfo(regionInfo: unknown, orientation: unknown, width: number, height: number): { location: FaceBox; name: string | null }[] {
  const list = (regionInfo as Record<string, unknown> | null)?.RegionList;
  if (!Array.isArray(list)) return [];
  const orient = typeof orientation === "string" ? orientation : null;
  const out: { location: FaceBox; name: string | null }[] = [];
  for (const region of list) {
    if (!region || region.Type !== "Face") continue;
    if (!hasNormalizedArea(region.Area, region.AppliedToDimensions)) continue;
    const location = nonEmptyObject(region.Area) ? toFaceBox(region.Area, orient, width, height) : null;
    if (!location) {
      console.info("broken face area exif data: no numerical positional data");
      continue;
    }
    const name = typeof region.Name === "string" ? region.Name : typeof region.Name === "number" ? String(region.Name) : null;
    out.push({ location, name });
  }
  return out;
}

// ------------------------------------------------------ encoding back-fill

/** generate_face_embeddings: encodings for faces stored without one (XMP regions), as its own job; none when there are none. */
export async function generateFaceEmbeddings(userId: number): Promise<void> {
  const faces: { id: number; t: number; r: number; b: number; l: number; thumbnail_big: string | null }[] =
    await client`SELECT f.id, f.location_top AS t, f.location_right AS r, f.location_bottom AS b, f.location_left AS l, t.thumbnail_big
      FROM api_face f JOIN api_photo p ON p.id = f.photo_id LEFT JOIN api_thumbnail t ON t.photo_id = p.id
      WHERE p.owner_id = ${userId} AND f.encoding = '' ORDER BY f.id`;
  if (!faces.length) return;
  const jobId = await begin(null, JobType.GenerateFaceEmbeddings, userId);
  await setProgress(jobId, 0, faces.length);
  const model = (await siteSettings()).FACE_RECOGNITION_MODEL;
  const counter = new ItemCounter(jobId, faces.length);
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    if (i % CANCEL_CHECK_EVERY === 0 && (await isCancelled(jobId))) {
      await counter.flush();
      return;
    }
    let error: string | null = null;
    try {
      if (!face.thumbnail_big) throw new Error("The 'thumbnail_big' attribute has no file associated with it.");
      const encodings = await faceApi.faceEncodings(mediaPath(face.thumbnail_big), [[face.t, face.r, face.b, face.l]], model);
      if (!encodings.length) throw new Error(`Face service returned no encoding for face ${face.id}`);
      if (!encodings[0]) throw new Error(`The face service detected no face in face ${face.id}`);
      await client`UPDATE api_face SET encoding = ${encodeFaceEncoding(encodings[0])} WHERE id = ${face.id}`;
    } catch (e) {
      error = `Face ${face.id}: ${(e as Error).message}`;
    }
    await counter.done(error);
  }
  await counter.finish();
  await complete(jobId);
}
