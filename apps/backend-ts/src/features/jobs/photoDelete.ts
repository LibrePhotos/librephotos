// Photo.delete() for many photos, as Django's collector does it (port of
// lp_db::write::photo_delete::hard_delete): every dependent row is deleted
// or nulled explicitly, a mobile-sync DeletionLog tombstone is written for
// the owner and every shared_to user (post_delete), and face crops plus
// orphaned thumbnail files are removed after commit. Used by the
// cleanup_deleted_photos schedule here; the same service backs
// delete_missing_photos and the permanent delete in other areas.
import { unlink } from "node:fs/promises";
import path from "node:path";
import { arrayLiteral, type client } from "~/lib/db";

type Exec = typeof client;

/** on_delete=SET_NULL relations of Photo and its cascaded Face rows. Person.cover_face goes before the faces. */
const SET_NULL = [
  "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN (SELECT f.id FROM api_face f WHERE f.photo_id = ANY($1::uuid[]))",
  "UPDATE api_person SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1::uuid[])",
  "UPDATE api_albumuser SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1::uuid[])",
  "UPDATE api_photostack SET primary_photo_id = NULL WHERE primary_photo_id = ANY($1::uuid[])",
  "UPDATE api_duplicate SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1::uuid[])",
  "UPDATE api_stackreview SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1::uuid[])",
];

/** on_delete=CASCADE relations and every M2M through table holding photo_id. */
const CASCADE = [
  "api_tag_photos",
  "api_photo_stacks",
  "api_photo_duplicates",
  "api_metadataedit",
  "api_metadatafile",
  "api_photometadata",
  "api_photo_ocr",
  "api_photoshare",
  "api_photo_shared_to",
  "api_photo_files",
  "api_face",
  "api_thumbnail",
  "api_photo_search",
  "api_photo_caption",
  "api_albumdate_photos",
  "api_albumauto_photos",
  "api_albumuser_photos",
  "api_albumplace_photos",
  "api_albumthing_photos",
  "api_albumthing_cover_photos",
];

/** Thumbnail files named after a hash (delete_thumbnail_files). */
const THUMBNAIL_FILES: [string, string][] = [
  ["thumbnails_big", "webp"],
  ["square_thumbnails", "webp"],
  ["square_thumbnails_small", "webp"],
  ["square_thumbnails", "mp4"],
  ["square_thumbnails_small", "mp4"],
];

/** Delete `ids` for good inside the caller's transaction. Returns the files to remove after commit. */
export async function hardDeletePhotos(tx: Exec, ids: string[], mediaRoot: string): Promise<string[]> {
  if (!ids.length) return [];
  const arr = arrayLiteral(ids);
  // post_delete tombstones (owner and shared_to users), before the rows go.
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
  for (const q of SET_NULL) await tx.unsafe(q, [arr]);
  for (const t of CASCADE) await tx.unsafe(`DELETE FROM ${t} WHERE photo_id = ANY($1::uuid[])`, [arr]);
  await tx.unsafe("DELETE FROM api_photo WHERE id = ANY($1::uuid[])", [arr]);

  const files = crops.map((c) => path.join(mediaRoot, c.image));
  // delete_orphaned_thumbnail_files, per deleted Thumbnail row: its files stay
  // while another Thumbnail row names one of them, and a hash's files stay
  // while a photo still carries that hash.
  const groups = thumbs.map((t) => [t.a, t.b, t.c].filter((n) => n)).filter((g) => g.length);
  if (!groups.length) return files;
  const names = [...new Set(groups.flat())];
  const named: { n: string }[] = await tx.unsafe(
    `SELECT thumbnail_big AS n FROM api_thumbnail WHERE thumbnail_big = ANY($1::text[])
     UNION SELECT square_thumbnail FROM api_thumbnail WHERE square_thumbnail = ANY($1::text[])
     UNION SELECT square_thumbnail_small FROM api_thumbnail WHERE square_thumbnail_small = ANY($1::text[])`,
    [arrayLiteral(names)],
  );
  const stillNamed = new Set(named.map((r) => r.n));
  const stems = [
    ...new Set(
      groups
        .filter((g) => !g.some((n) => stillNamed.has(n)))
        .flat()
        .map((n) => path.parse(n).name),
    ),
  ].filter(Boolean);
  if (!stems.length) return files;
  const used: { h: string }[] = await tx.unsafe("SELECT DISTINCT image_hash AS h FROM api_photo WHERE image_hash = ANY($1::text[])", [
    arrayLiteral(stems),
  ]);
  const stillUsed = new Set(used.map((r) => r.h));
  for (const h of stems.filter((s) => !stillUsed.has(s))) {
    for (const [dir, ext] of THUMBNAIL_FILES) files.push(path.join(mediaRoot, dir, `${h}.${ext}`));
  }
  return files;
}

/** Best effort: a missing file is fine, other errors are logged. */
export async function deleteFilesAfterCommit(files: string[]) {
  for (const f of files) {
    await unlink(f).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") console.warn(`after-commit delete of ${f} failed`, e);
    });
  }
}
