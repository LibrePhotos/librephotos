// Bulk metadata write-back (port of lp-ingest metadata_backfill.rs):
// `manage.py save_metadata` and POST /api/savemetadata, a loop of
// write_photo_metadata(photo, use_sidecar, metadata_types) with
// modified_fields=None: the current rating ("ratings") and the face regions
// ("face_tags") of every selected photo, merged into one ExifTool write.
import { client } from "../../lib/db";
import { exif } from "../../lib/exif";
import { regionTags } from "./faceTags";

export const RATINGS = "ratings";
export const FACE_TAGS = "face_tags";

/** The command looks at photos with any face; the view at photos with a user-labelled face. */
export type FaceFilter = "any" | "labelled";

/** The photos to write, in id order: all or `owner`'s; only those with faces when types is exactly ["face_tags"]. */
export async function selectPhotos(owner: number | null, types: string[], faceFilter: FaceFilter): Promise<string[]> {
  const facesOnly = types.length === 1 && types[0] === FACE_TAGS;
  const faceSql = !facesOnly
    ? ""
    : faceFilter === "any"
      ? " AND EXISTS (SELECT 1 FROM api_face f WHERE f.photo_id = p.id AND NOT f.deleted)"
      : " AND EXISTS (SELECT 1 FROM api_face f JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = p.id AND NOT f.deleted AND pe.kind = 'USER')";
  const r = await client.unsafe(`SELECT p.id::text AS id FROM api_photo p WHERE ($1::int IS NULL OR p.owner_id = $1)${faceSql} ORDER BY p.id`, [owner]);
  return r.map((x: { id: string }) => x.id);
}

/** write_photo_metadata with modified_fields=None; false when nothing was written. */
export async function writePhoto(photoId: string, types: string[], useSidecar: boolean): Promise<boolean> {
  const [row] = await client`SELECT p.rating, f.path FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = ${photoId}::uuid`;
  if (!row) return false;
  const tags: [string, unknown][] = [];
  if (types.includes(RATINGS)) tags.push(["Rating", row.rating]);
  if (types.includes(FACE_TAGS)) {
    const found = await regionTags(photoId);
    if (found) tags.push(...found.tags);
  }
  if (!tags.length) return false;
  // Django: photo.main_file.path on a photo without one raises.
  if (!row.path) throw new Error("'NoneType' object has no attribute 'path'");
  await exif.writeMetadata(row.path, tags, useSidecar);
  return true;
}

export interface Outcome {
  written: number;
  errors: number;
}

/** Write every photo in `ids`, reporting errors and progress (every 100 photos) as it goes. */
export async function writeAll(
  ids: string[],
  types: string[],
  useSidecar: boolean,
  onError: (hashOrId: string, e: Error) => void,
  onProgress: (i: number, o: Outcome) => void,
): Promise<Outcome> {
  const out: Outcome = { written: 0, errors: 0 };
  for (let i = 0; i < ids.length; i++) {
    try {
      await writePhoto(ids[i], types, useSidecar);
      out.written++;
    } catch (e) {
      out.errors++;
      const r = await client`SELECT image_hash FROM api_photo WHERE id = ${ids[i]}::uuid`.catch(() => []);
      onError(r[0]?.image_hash ?? ids[i], e as Error);
    }
    if ((i + 1) % 100 === 0) onProgress(i + 1, { ...out });
  }
  return out;
}
