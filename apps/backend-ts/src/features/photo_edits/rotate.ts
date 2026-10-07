// POST /photosedit/rotate/ (RotatePhotoView): non-destructive rotation (port
// of lp_api::photo_edits::rotate). The thumbnails are rebuilt inside the
// request, as Django does, so the UI reloads the rotated ones; a failed
// render falls back to the thumbnails.rerender job. With
// save_metadata_to_disk on, the orientation is written to the file or its
// XMP sidecar in the request.
import { sql } from "drizzle-orm";
import { db, row, type Tx } from "~/lib/db";
import { pyIsoTs } from "~/lib/time";
import { enqueue } from "~/lib/jobs";
import { pyTruthy } from "~/lib/query";
import type { User } from "~/lib/users";
import { metadataToDisk, object, pyStr, statusMessage } from "./common";
import { readOrientation, writeMetadata } from "./exiftool";
import { ownedByHash, type OwnedPhoto } from "./reads";
import { regenerateThumbnails } from "./thumbnails";

/** EXIF orientation 1-8 as [n, m]: n 90-degree CW steps, then m horizontal flips. */
const ORIENTATION_TO_PARAMS: [number, [number, number]][] = [
  [1, [0, 0]],
  [2, [0, 1]],
  [3, [2, 0]],
  [4, [2, 1]],
  [5, [3, 1]],
  [6, [1, 0]],
  [7, [1, 1]],
  [8, [3, 0]],
];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** api.util.compose_orientation (D4 group multiplication). */
export function composeOrientation(current: number, deltaAngleCw: number, flipH: boolean): number {
  const [nA, mA] = ORIENTATION_TO_PARAMS.find(([o]) => o === current)?.[1] ?? [0, 0];
  // Rust's f64::round (half away from zero) of angle / 90.
  const q = deltaAngleCw / 90;
  const nB = mod(Math.sign(q) * Math.round(Math.abs(q)), 4);
  const mB = flipH ? 1 : 0;
  const n = mod(nB + (mB === 0 ? nA : -nA), 4);
  const m = mod(mB + mA, 2);
  return ORIENTATION_TO_PARAMS.find(([, [a, b]]) => a === n && b === m)?.[0] ?? 1;
}

/** api.thumbnails.exif_orientation_showing(exif, local), tabulated from libvips. */
const EXIF_ORIENTATION_SHOWING = [
  [1, 2, 3, 4, 5, 8, 7, 6],
  [2, 1, 4, 3, 8, 5, 6, 7],
  [3, 4, 1, 2, 7, 6, 5, 8],
  [4, 3, 2, 1, 6, 7, 8, 5],
  [5, 6, 7, 8, 1, 4, 3, 2],
  [6, 5, 8, 7, 4, 1, 2, 3],
  [7, 8, 5, 6, 3, 2, 1, 4],
  [8, 7, 6, 5, 2, 3, 4, 1],
];

/** libvips treats an orientation outside 1-8 as upright. */
export function exifOrientationShowing(exif: number, local: number): number {
  const idx = (o: number) => (o >= 1 && o <= 8 ? o - 1 : 0);
  return EXIF_ORIENTATION_SHOWING[idx(exif)][idx(local)];
}

/** _EXIF_ORIENTED_EXTENSIONS (none of them a RAW extension). */
function rendersExifOrientation(p: string): boolean {
  const name = p.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return ["jpg", "jpeg", "jpe", "jfif", "tif", "tiff", "png", "webp"].includes(name.slice(dot + 1).toLowerCase());
}

async function lockLocalOrientation(tx: Tx, id: string): Promise<number> {
  return (await row<{ o: number }>(sql`SELECT local_orientation AS o FROM api_photo WHERE id = ${id} FOR UPDATE`, tx))!.o;
}

/**
 * _fold_rotation_into_file: undefined when the file cannot take the rotation
 * (nothing written), else the local_orientation to report. ExifTool runs
 * outside any transaction; the DB part is its own short transaction.
 */
async function foldRotationIntoFile(photoId: string, file: string, local: number): Promise<number | undefined> {
  if (!rendersExifOrientation(file)) return undefined;
  const onDisk = await readOrientation(file);
  if (onDisk === undefined) return undefined;
  const combined = exifOrientationShowing(onDisk, local);
  await writeMetadata(file, [["EXIF:Orientation", combined]], false);
  const written = await readOrientation(file);
  if (written !== combined) {
    console.warn(`orientation was not written to ${file} (${combined}, read back ${written}); keeping the rotation in the database`);
    return local;
  }
  // _adopt_written_orientation: the file now carries the whole rotation.
  // update_fields saves: no last_modified bump.
  const adopted = await db.transaction(async (tx) => {
    if ((await lockLocalOrientation(tx, photoId)) !== local) return false;
    await tx.execute(sql`UPDATE api_photo SET local_orientation = 1 WHERE id = ${photoId} AND local_orientation <> 1`);
    await tx.execute(sql`UPDATE api_photometadata SET orientation = ${combined}
      WHERE photo_id = ${photoId} AND orientation IS DISTINCT FROM ${combined}`);
    return true;
  });
  if (!adopted) {
    console.warn(`another rotation changed local_orientation during the write of ${file}; not adopting`);
    return local;
  }
  return 1;
}

/** write_orientation_to_disk for an owner with save_metadata_to_disk on. */
async function writeOrientationToDisk(user: User, photo: OwnedPhoto, angle: number, flip: boolean, local: number): Promise<number> {
  const useSidecar = user.saveMetadataToDisk === "SIDECAR_FILE";
  const file = photo.main_file_path;
  if (!file) throw new Error("photo has no main file");
  if (!useSidecar) {
    const shown = await foldRotationIntoFile(photo.id, file, local);
    if (shown !== undefined) return shown;
  }
  const md = await row<{ orientation: number | null }>(sql`SELECT orientation FROM api_photometadata WHERE photo_id = ${photo.id}`);
  const exifOrientation = md?.orientation ? md.orientation : 1;
  const combined = composeOrientation(exifOrientation, angle, flip);
  await writeMetadata(file, [["EXIF:Orientation", combined]], useSidecar);
  return local;
}

/** _parse_rotation_angle: Python int(raw), a multiple of 90. */
function parseAngle(raw: unknown): number | string {
  let angle: number;
  if (raw === undefined) angle = 0;
  else if (typeof raw === "boolean") angle = raw ? 1 : 0;
  else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "angle must be an integer";
    angle = Math.trunc(raw);
  } else if (typeof raw === "string") {
    const t = raw.trim().replaceAll("_", "");
    if (!/^[+-]?\d+$/.test(t)) return "angle must be an integer";
    angle = Number(t);
  } else return "angle must be an integer";
  if (angle % 90 !== 0) return "angle must be a multiple of 90 degrees";
  return angle;
}

async function regenerate(photoId: string) {
  try {
    await regenerateThumbnails(photoId);
  } catch (e) {
    console.warn(`thumbnail render failed for ${photoId}, queueing thumbnails.rerender: ${e}`);
    await enqueue("thumbnails.rerender", { photo_id: photoId });
  }
}

export async function rotatePhoto(user: User, raw: unknown) {
  const body = object(raw);
  const flip = pyTruthy(body.flip_horizontal);
  if (!pyTruthy(body.image_hash)) return statusMessage(400, "image_hash is required");
  const imageHash = pyStr(body.image_hash);
  const parsed = parseAngle(body.angle);
  if (typeof parsed === "string") return statusMessage(400, parsed);
  const photo = await ownedByHash(user.id, imageHash);
  if (!photo) return statusMessage(404, "photo not found");
  if (photo.video) return statusMessage(400, "rotation is not supported for videos");

  const angle = mod(parsed, 360);
  if (angle === 0 && !flip)
    return { status: true, image_hash: photo.image_hash, local_orientation: photo.local_orientation, last_modified: photo.last_modified };

  // The orientation in one short transaction; the ExifTool work runs after its commit.
  const { orientation, lastModified } = await db.transaction(async (tx) => {
    const o = composeOrientation(await lockLocalOrientation(tx, photo.id), angle, flip);
    const r = await row<{ lm: string }>(
      sql`UPDATE api_photo SET local_orientation = ${o}, last_modified = now() WHERE id = ${photo.id}
        RETURNING ${pyIsoTs("last_modified")} AS lm`,
      tx,
    );
    return { orientation: o, lastModified: r!.lm };
  });
  let shown = orientation;
  let diskFailed = false;
  // Before the render: it must not see the file rotated while local_orientation still carries the turn.
  if (photo.has_thumbnail_row && metadataToDisk(user)) {
    try {
      shown = await writeOrientationToDisk(user, photo, angle, flip, orientation);
    } catch (e) {
      console.warn(`Failed to rotate photo ${imageHash}: ${e}`);
      diskFailed = true;
    }
  }
  if (photo.has_thumbnail_row) await regenerate(photo.id);
  // Django saved the orientation, then failed regenerating the thumbnails or writing the file.
  if (!photo.has_thumbnail_row || diskFailed) return statusMessage(500, "failed to rotate photo");
  return { status: true, image_hash: photo.image_hash, local_orientation: shown, last_modified: lastModified };
}
