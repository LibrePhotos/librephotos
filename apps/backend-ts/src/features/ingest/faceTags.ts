// Face regions written back to the photo's file or XMP sidecar after a face
// is labelled or drawn (port of lp-ingest face_tags.rs;
// api/metadata/face_regions.py through write_photo_metadata(["face_tags"])),
// when the owner turned on save_face_tags_to_disk. The target is the XMP
// sidecar when save_metadata_to_disk is SIDECAR_FILE, the media file
// otherwise. Like Rust (unlike Django) the orientation is read printed, so a
// written region reads back onto the same face.
import path from "node:path";
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { exif } from "../../lib/exif";
import { enqueue, type JobCtx } from "../../lib/jobs";
import { isNumber, numberOf, type PyValue } from "./pyfmt";
import { imageSize } from "./render";

export const KIND = "metadata.face_tags";
export const REGION_INFO_WRITE = "XMP-mwg-rs:RegionInfo";
export const SUBJECT = "XMP:Subject";

/** Queue the write for `photoIds` when the user opted in; never fails the caller. */
export async function queueFaceTags(user: { saveFaceTagsToDisk: boolean }, photoIds: string[]) {
  if (!user.saveFaceTagsToDisk || !photoIds.length) return;
  const ids = [...new Set(photoIds)].sort();
  try {
    await enqueue(KIND, { photo_ids: ids });
  } catch (e) {
    console.error(`could not queue the face tag write: ${e}`);
  }
}

// Two label requests in a row queue two jobs for the same photo; concurrent
// ExifTool writes race on one file. One at a time, each reading the faces
// when it starts, so the file ends with the latest labels.
let writes: Promise<unknown> = Promise.resolve();

export async function runFaceTags(ctx: JobCtx) {
  const ids = ctx.payload?.photo_ids;
  if (!Array.isArray(ids)) throw new Error(`bad ${KIND} payload: photo_ids missing`);
  for (const id of ids as string[]) {
    const mine = writes.then(() => writeFaceTags(id));
    writes = mine.catch(() => {});
    try {
      await mine;
    } catch (e) {
      console.error(`Failed to write face tags of ${id}: ${(e as Error).message}`);
    }
  }
}

export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RegionTags {
  imageHash: string;
  path: string;
  saveMetadataToDisk: string;
  tags: [string, unknown][];
}

/** Write the photo's face regions; false when there was nothing to write. */
export async function writeFaceTags(photoId: string): Promise<boolean> {
  const found = await regionTags(photoId);
  if (!found) return false;
  const useSidecar = found.saveMetadataToDisk === "SIDECAR_FILE";
  console.info(`writing face regions of ${found.imageHash} (sidecar ${useSidecar})`);
  await exif.writeMetadata(found.path, found.tags, useSidecar);
  return true;
}

/** get_face_region_tags: null when no main file, no faces or no readable thumbnail. */
export async function regionTags(photoId: string): Promise<RegionTags | null> {
  const [photo] = await client`SELECT p.image_hash, f.path, t.thumbnail_big, u.save_metadata_to_disk
    FROM api_photo p JOIN api_user u ON u.id = p.owner_id LEFT JOIN api_file f ON f.hash = p.main_file_id
    LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.id = ${photoId}::uuid`;
  if (!photo || !photo.path) return null;
  const faces: { location_top: number; location_right: number; location_bottom: number; location_left: number; person_kind: string | null; person_name: string | null }[] =
    await client`SELECT f.location_top, f.location_right, f.location_bottom, f.location_left, pe.kind AS person_kind, pe.name AS person_name
      FROM api_face f LEFT JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = ${photoId}::uuid AND NOT f.deleted ORDER BY f.id`;
  if (!faces.length) return null;
  const size = photo.thumbnail_big ? await imageSize(path.join(config.mediaRoot, photo.thumbnail_big)) : null;
  if (!size) {
    console.error(`Cannot open thumbnail for photo ${photo.image_hash}, skipping face tags`);
    return null;
  }
  const [orientationValue] = await exif.getMetadata(photo.path, ["EXIF:Orientation"], true, true);
  const dims = await exif.getMetadata(photo.path, ["ImageWidth", "ImageHeight"], true, false);
  const orientation = typeof orientationValue === "string" ? orientationValue : "";
  const regions = faces.map((f) => {
    const [x, y, w, h] = reverseOrientationTransform(
      ...thumbnailCoordsToNormalized(f.location_top, f.location_right, f.location_bottom, f.location_left, size[0], size[1]),
      orientation,
    );
    return { name: f.person_kind === "USER" && f.person_name !== null ? f.person_name : "", x, y, w, h };
  });
  return { imageHash: photo.image_hash, path: photo.path, saveMetadataToDisk: photo.save_metadata_to_disk, tags: buildFaceRegionArgs(regions, dims[0], dims[1]) };
}

export function thumbnailCoordsToNormalized(top: number, right: number, bottom: number, left: number, width: number, height: number): [number, number, number, number] {
  return [(left + right) / 2 / width, (top + bottom) / 2 / height, (right - left) / width, (bottom - top) / height];
}

/** reverse_orientation_transform (inverse of face_extractor's transforms). */
export function reverseOrientationTransform(x: number, y: number, w: number, h: number, orientation: string): [number, number, number, number] {
  switch (orientation) {
    case "Rotate 90 CW":
    case "Mirror horizontal and rotate 270 CW":
      return [y, 1 - x, h, w];
    case "Mirror horizontal":
      return [1 - x, y, w, h];
    case "Rotate 180":
      return [1 - x, 1 - y, w, h];
    case "Mirror vertical":
      return [x, 1 - y, w, h];
    case "Mirror horizontal and rotate 90 CW":
    case "Rotate 270 CW":
      return [1 - y, x, h, w];
    default:
      return [x, y, w, h];
  }
}

/** _escape_exiftool_value. */
const escape = (v: string) => v.replace(/[\\{}=,]/g, (c) => `\\${c}`);

/** Python's f"{x:.6f}" (a negative zero keeps its sign). */
const f6 = (x: number) => (Object.is(x, -0) ? "-0.000000" : x.toFixed(6));

function truthyDim(v: PyValue | null | undefined): string | null {
  if (typeof v === "string") return v === "" ? null : v;
  if (v != null && typeof v !== "boolean" && isNumber(v)) {
    const n = numberOf(v)!;
    if (n === 0) return null;
    if (typeof v === "object") return Number.isInteger(n) ? `${n}.0` : String(n);
    return String(v);
  }
  return null;
}

/** build_face_region_exiftool_args: the structured RegionInfo value plus labelled names as XMP:Subject. */
export function buildFaceRegionArgs(regions: Region[], imageWidth: PyValue | null | undefined, imageHeight: PyValue | null | undefined): [string, unknown][] {
  const parts = regions.map((r) => `{Area={X=${f6(r.x)},Y=${f6(r.y)},W=${f6(r.w)},H=${f6(r.h)},Unit=normalized},Name=${escape(r.name)},Type=Face}`);
  const w = truthyDim(imageWidth);
  const h = truthyDim(imageHeight);
  const appliedTo = w !== null && h !== null ? `AppliedToDimensions={W=${w},H=${h},Unit=pixel},` : "";
  const tags: [string, unknown][] = [[REGION_INFO_WRITE, `{${appliedTo}RegionList=[${parts.join(",")}]}`]];
  const names = regions.filter((r) => r.name !== "").map((r) => r.name);
  if (names.length) tags.push([SUBJECT, names]);
  return tags;
}
