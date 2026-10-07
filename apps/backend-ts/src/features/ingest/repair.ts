// Library maintenance jobs (port of lp-ingest repair.rs):
// scan_missing_photos (detach vanished files), repair_ungrouped_file_variants
// and delete_missing_photos.
import { arrayLiteral, client } from "../../lib/db";
import { JobType, lrjFail, lrjIsCancelled } from "../../lib/jobs";
import * as db from "./db";
import { begin, type Q } from "./db";
import { exists, IMAGE, RAW_FILE, splitext } from "./fsutil";
import { config } from "../../lib/config";
import { hardDeletePhotos } from "../jobs/photoDelete";
import { AfterCommit } from "./pipeline";

const PAGE = 5000;
const DELETE_BATCH = 1000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * scan_missing_photos: per page of 5000 photos, unlink files gone from disk
 * and flag them missing. Only a photo that actually lost a file gets its
 * last_modified bumped (Django #2124).
 */
export async function scanMissingPhotos(userId: number, jobId: string) {
  await db.lrjGetOrCreate(jobId, JobType.ScanMissingPhotos, userId);
  try {
    const total = await db.photoCount(userId);
    const pages = Math.ceil(total / PAGE);
    await db.lrjProgress(jobId, 0, pages);
    for (let page = 0; page < pages; page++) {
      if (await lrjIsCancelled(jobId)) return;
      const ids: string[] = (
        await client`SELECT id::text AS id FROM api_photo WHERE owner_id = ${userId} ORDER BY image_hash, id OFFSET ${page * PAGE} LIMIT ${PAGE}`
      ).map((r: { id: string }) => r.id);
      const links: { photo_id: string; hash: string; path: string }[] = await client`SELECT pf.photo_id::text AS photo_id, f.hash, f.path
        FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id WHERE pf.photo_id = ANY(${arrayLiteral(ids)}::uuid[])`;
      const gone = links.filter((l) => !l.path || !exists(l.path));
      await begin(async (tx) => {
        for (const g of gone) {
          await tx`DELETE FROM api_photo_files WHERE photo_id = ${g.photo_id}::uuid AND file_id = ${g.hash}`;
          await tx`UPDATE api_file SET missing = TRUE WHERE hash = ${g.hash}`;
        }
        const touched = [...new Set(gone.map((g) => g.photo_id))].sort();
        if (touched.length) await tx`UPDATE api_photo SET last_modified = now() WHERE id = ANY(${arrayLiteral(touched)}::uuid[])`;
        await tx`UPDATE api_longrunningjob SET progress_current = progress_current + 1 WHERE job_id = ${jobId}`;
      });
    }
    await db.lrjFinish(jobId);
  } catch (e) {
    await lrjFail(jobId, errText(e));
  }
}

/** find_matching_jpeg_photo: the owner's photo whose main file is the same basename with an image extension. */
async function matchingJpegPhoto(q: Q, userId: number, rawPath: string): Promise<string | null> {
  const base = splitext(rawPath)[0];
  const candidates = [".jpg", ".jpeg", ".heic", ".heif", ".png", ".tiff", ".tif"].flatMap((e) => [`${base}${e}`, `${base}${e.toUpperCase()}`]);
  const arr = arrayLiteral(candidates);
  const r = await q`SELECT p.id::text AS id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id
    WHERE p.owner_id = ${userId} AND f.path = ANY(${arr}::text[]) ORDER BY array_position(${arr}::text[], f.path), p.id LIMIT 1`;
  return r[0]?.id ?? null;
}

/** repair_ungrouped_file_variants. */
export async function repairFileVariants(userId: number, jobId: string) {
  await db.lrjGetOrCreate(jobId, JobType.RepairFileVariants, userId);
  try {
    const rawPhotos: { id: string; path: string }[] = await client`SELECT p.id::text AS id, f.path FROM api_photo p
      JOIN api_file f ON f.hash = p.main_file_id WHERE p.owner_id = ${userId} AND f.type = ${RAW_FILE} ORDER BY p.id`;
    await db.lrjProgress(jobId, 0, rawPhotos.length);
    const after = new AfterCommit();
    let merged = 0;
    let promoted = 0;
    for (const { id: photo, path: rawPath } of rawPhotos) {
      await begin(async (tx) => {
        const image = await tx`SELECT f.hash FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id
          WHERE pf.photo_id = ${photo}::uuid AND f.type = ${IMAGE} ORDER BY f.hash LIMIT 1`;
        if (image.length) {
          await tx`UPDATE api_photo SET main_file_id = ${image[0].hash}, video = FALSE WHERE id = ${photo}::uuid`;
          promoted++;
          return;
        }
        const jpeg = await matchingJpegPhoto(tx, userId, rawPath);
        if (jpeg && jpeg !== photo) {
          const hashes: { file_id: string }[] = await tx`SELECT file_id FROM api_photo_files WHERE photo_id = ${photo}::uuid ORDER BY id`;
          for (const h of hashes) await db.addPhotoFile(tx, jpeg, h.file_id);
          await db.touchPhoto(tx, jpeg);
          for (const f of await hardDeletePhotos(tx, [photo], config.mediaRoot)) after.deleteFile(f);
          merged++;
        }
      });
    }
    after.run();
    console.info(`repaired file variants of user ${userId}: merged ${merged}, promoted ${promoted}`);
    await db.lrjComplete(jobId);
  } catch (e) {
    await lrjFail(jobId, errText(e));
  }
}

/** delete_missing_photos: photos without files or main file go, then the user's missing File rows. */
export async function deleteMissingPhotos(userId: number, jobId: string) {
  await db.lrjGetOrCreate(jobId, JobType.DeleteMissingPhotos, userId);
  try {
    const missing: string[] = (
      await client`SELECT p.id::text AS id FROM api_photo p WHERE p.owner_id = ${userId} AND (p.main_file_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id)) ORDER BY p.id`
    ).map((r: { id: string }) => r.id);
    const target = missing.length;
    await db.lrjProgress(jobId, 0, target);
    const things = new Set<number>();
    const tags = new Set<number>();
    const after = new AfterCommit();
    let done = 0;
    for (let i = 0; i < missing.length; i += DELETE_BATCH) {
      const batch = missing.slice(i, i + DELETE_BATCH);
      const arr = arrayLiteral(batch);
      await begin(async (tx) => {
        for (const r of await tx`SELECT DISTINCT albumthing_id AS id FROM api_albumthing_photos WHERE photo_id = ANY(${arr}::uuid[])`) things.add(r.id);
        for (const r of await tx`SELECT DISTINCT tag_id AS id FROM api_tag_photos WHERE photo_id = ANY(${arr}::uuid[])`) tags.add(r.id);
        for (const f of await hardDeletePhotos(tx, batch, config.mediaRoot)) after.deleteFile(f);
        done += batch.length;
        await tx`UPDATE api_longrunningjob SET progress_current = ${done}, progress_target = ${target} WHERE job_id = ${jobId}`;
      });
    }
    after.run();
    await begin(async (tx) => {
      for (const thing of [...things].sort((a, b) => a - b)) {
        await tx`UPDATE api_albumthing SET photo_count = (SELECT count(*) FROM api_albumthing_photos tp
            JOIN api_photo p ON p.id = tp.photo_id WHERE tp.albumthing_id = ${thing} AND NOT p.hidden) WHERE id = ${thing}`;
        const added = await tx`INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id)
          SELECT ${thing}, p.id FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id
          WHERE tp.albumthing_id = ${thing} AND NOT p.hidden AND p.id NOT IN
            (SELECT photo_id FROM api_albumthing_cover_photos WHERE albumthing_id = ${thing} AND photo_id IS NOT NULL)
          LIMIT GREATEST(0, 4 - (SELECT count(*) FROM api_albumthing_cover_photos WHERE albumthing_id = ${thing})) RETURNING 1`;
        // cover_photos.add(...) fires the mobile-sync bump; photo_count alone does not.
        if (added.length) await tx`UPDATE api_albumthing SET last_modified = now() WHERE id = ${thing}`;
      }
      if (tags.size) {
        await tx`UPDATE api_tag t SET photo_count = COALESCE((SELECT count(*) FROM api_tag_photos tp
            JOIN api_photo p ON p.id = tp.photo_id WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), 0)
          WHERE t.id = ANY(${arrayLiteral([...tags])}::int[])`;
      }
      // The hash is the md5 followed by the owner id; match the whole suffix
      // (Django's hash__endswith also takes user 11's files for user 1).
      const files: string[] = (
        await tx`SELECT hash FROM api_file WHERE missing AND length(hash) > 32 AND substr(hash, 33) = ${String(userId)}`
      ).map((r: { hash: string }) => r.hash);
      await deleteFiles(tx, files);
    });
    await db.lrjComplete(jobId);
  } catch (e) {
    await lrjFail(jobId, errText(e));
  }
}

/** Delete File rows with Django's cascade (links, embedded media, metadata records, main-file pointers). */
export async function deleteFiles(tx: Q, hashes: string[]) {
  if (!hashes.length) return;
  const arr = arrayLiteral(hashes);
  await tx`DELETE FROM api_photo_files WHERE file_id = ANY(${arr}::text[])`;
  await tx`DELETE FROM api_file_embedded_media WHERE from_file_id = ANY(${arr}::text[]) OR to_file_id = ANY(${arr}::text[])`;
  await tx`DELETE FROM api_metadatafile WHERE file_id = ANY(${arr}::text[])`;
  await tx`UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ANY(${arr}::text[])`;
  await tx`DELETE FROM api_file WHERE hash = ANY(${arr}::text[])`;
}
