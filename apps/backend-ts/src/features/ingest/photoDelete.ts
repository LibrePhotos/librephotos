// Photo.delete() for many photos, as Django's collector does it (port of
// lp-db write/photo_delete.rs + the deletion_log tombstones): every dependent
// row deleted or nulled explicitly, a mobile-sync DeletionLog tombstone per
// owner and shared_to user, face crops and orphaned thumbnail files deleted
// after commit.
import path from "node:path";
import { arrayLiteral } from "../../lib/db";
import { config } from "../../lib/config";
import type { Q } from "./db";
import type { AfterCommit } from "./pipeline";

/** on_delete=SET_NULL relations: (table, column, the photo-id expression it is nulled for). */
const SET_NULL: [string, string, string][] = [
  ["api_person", "cover_face_id", "(SELECT f.id FROM api_face f WHERE f.photo_id = ANY($1::uuid[]))"],
  ["api_person", "cover_photo_id", ""],
  ["api_albumuser", "cover_photo_id", ""],
  ["api_photostack", "primary_photo_id", ""],
  ["api_duplicate", "kept_photo_id", ""],
  ["api_stackreview", "kept_photo_id", ""],
];

/** on_delete=CASCADE relations: (table, photo-id column). */
const CASCADE: [string, string][] = [
  ["api_tag_photos", "photo_id"],
  ["api_photo_stacks", "photo_id"],
  ["api_photo_duplicates", "photo_id"],
  ["api_metadataedit", "photo_id"],
  ["api_metadatafile", "photo_id"],
  ["api_photometadata", "photo_id"],
  ["api_photo_ocr", "photo_id"],
  ["api_photoshare", "photo_id"],
  ["api_photo_shared_to", "photo_id"],
  ["api_photo_files", "photo_id"],
  ["api_face", "photo_id"],
  ["api_thumbnail", "photo_id"],
  ["api_photo_search", "photo_id"],
  ["api_photo_caption", "photo_id"],
  ["api_albumdate_photos", "photo_id"],
  ["api_albumuser_photos", "photo_id"],
  ["api_albumauto_photos", "photo_id"],
  ["api_albumplace_photos", "photo_id"],
  ["api_albumthing_photos", "photo_id"],
  ["api_albumthing_cover_photos", "photo_id"],
];

const STATEMENTS = [
  ...SET_NULL.map(([t, c, of]) => `UPDATE ${t} SET ${c} = NULL WHERE ${of ? `${c} IN ${of}` : `${c} = ANY($1::uuid[])`}`),
  ...CASCADE.map(([t, c]) => `DELETE FROM ${t} WHERE ${c} = ANY($1::uuid[])`),
  "DELETE FROM api_photo WHERE id = ANY($1::uuid[])",
];

const THUMBNAIL_FILES: [string, string][] = [
  ["thumbnails_big", "webp"],
  ["square_thumbnails", "webp"],
  ["square_thumbnails_small", "webp"],
  ["square_thumbnails", "mp4"],
  ["square_thumbnails_small", "mp4"],
];

/** Delete `ids` for good inside the caller's transaction. */
export async function hardDelete(tx: Q, ids: string[], after: AfterCommit) {
  if (!ids.length) return;
  const arr = arrayLiteral(ids);
  // post_delete tombstones (owner and shared_to users), before the rows go;
  // clock_timestamp() so they sort after the bumps of the same transaction.
  await tx.unsafe(
    `INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at)
     SELECT 'photo', v.eid, v.uid, clock_timestamp() FROM (
       SELECT p.id::text AS eid, p.owner_id AS uid FROM api_photo p WHERE p.id = ANY($1::uuid[])
       UNION SELECT s.photo_id::text, s.user_id FROM api_photo_shared_to s WHERE s.photo_id = ANY($1::uuid[])) v
     WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid`,
    [arr],
  );
  const crops: { image: string }[] = await tx.unsafe(
    "SELECT image FROM api_face WHERE photo_id = ANY($1::uuid[]) AND image IS NOT NULL AND image <> ''",
    [arr],
  );
  const thumbs: { a: string; b: string; c: string }[] = await tx.unsafe(
    "SELECT thumbnail_big AS a, square_thumbnail AS b, square_thumbnail_small AS c FROM api_thumbnail WHERE photo_id = ANY($1::uuid[])",
    [arr],
  );
  for (const s of STATEMENTS) await tx.unsafe(s, [arr]);
  for (const c of crops) after.deleteFile(path.join(config.mediaRoot, c.image));
  // delete_orphaned_thumbnail_files: files stay while another Thumbnail row
  // names one of them, and a hash's files stay while a photo carries that hash.
  const rows = thumbs.map((t) => [t.a, t.b, t.c].filter(Boolean)).filter((n) => n.length);
  if (!rows.length) return;
  const names = [...new Set(rows.flat())];
  const namesArr = arrayLiteral(names);
  const stillNamed = new Set(
    (
      await tx.unsafe(
        `SELECT thumbnail_big AS n FROM api_thumbnail WHERE thumbnail_big = ANY($1::text[])
         UNION SELECT square_thumbnail FROM api_thumbnail WHERE square_thumbnail = ANY($1::text[])
         UNION SELECT square_thumbnail_small FROM api_thumbnail WHERE square_thumbnail_small = ANY($1::text[])`,
        [namesArr],
      )
    ).map((r: { n: string }) => r.n),
  );
  const stem = (n: string) => {
    const base = n.slice(Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  };
  const stems = [...new Set(rows.filter((ns) => !ns.some((n) => stillNamed.has(n))).flat().map(stem))].sort();
  if (!stems.length) return;
  const stillUsed = new Set(
    (await tx.unsafe("SELECT DISTINCT image_hash AS h FROM api_photo WHERE image_hash = ANY($1::text[])", [arrayLiteral(stems)])).map((r: { h: string }) => r.h),
  );
  for (const h of stems) {
    if (stillUsed.has(h)) continue;
    for (const [dir, ext] of THUMBNAIL_FILES) after.deleteFile(path.join(config.mediaRoot, dir, `${h}.${ext}`));
  }
}
