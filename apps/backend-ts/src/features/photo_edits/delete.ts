// DELETE /photosedit/delete/ with a JSON body (DeletePhotos): photo_files
// .remove_photo for the requester's trashed photos, in one transaction (port
// of lp_api::photo_edits::delete and lp_db::write::photo_edits::delete).
// Despite the name the photo row stays: it is marked removed, loses its
// files (a file row and its bytes go only when no other photo uses them),
// its cached transcode and its stack/duplicate memberships; stacks and
// duplicate groups left with one live photo or none are dissolved.
import { rm } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { db, pgArray, rows, type Tx } from "~/lib/db";
import { ownedBy } from "~/lib/scope";
import type { User } from "~/lib/users";
import { object, selectAllWhere, selection, uniq } from "./common";

/** Remove `ids` (already authorized). Returns the files to unlink after commit. */
async function removePhotos(tx: Tx, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const idArr = pgArray(ids, "uuid");
  const hashes = await rows<{ image_hash: string }>(sql`SELECT image_hash FROM api_photo WHERE id = ANY(${idArr})`, tx);
  const stacks = await rows<{ id: string }>(sql`SELECT DISTINCT photostack_id AS id FROM api_photo_stacks WHERE photo_id = ANY(${idArr})`, tx);
  const dups = await rows<{ id: string }>(sql`SELECT DISTINCT duplicate_id AS id FROM api_photo_duplicates WHERE photo_id = ANY(${idArr})`, tx);
  // Files only the removed photos use (via `files` or as a main file).
  const doomed = await rows<{ hash: string; path: string | null }>(
      sql`SELECT f.hash, f.path FROM api_file f
        WHERE f.hash IN (SELECT file_id FROM api_photo_files WHERE photo_id = ANY(${idArr}))
        AND NOT EXISTS (SELECT 1 FROM api_photo_files o JOIN api_photo op ON op.id = o.photo_id
                        WHERE o.file_id = f.hash AND NOT (o.photo_id = ANY(${idArr})))
        AND NOT EXISTS (SELECT 1 FROM api_photo op WHERE op.main_file_id = f.hash AND NOT (op.id = ANY(${idArr})))`,
    tx,
  );
  const doomedHashes = doomed.map((d) => d.hash);
  const dArr = pgArray(doomedHashes, "text");
  await tx.execute(sql`DELETE FROM api_photo_files WHERE photo_id = ANY(${idArr}) OR file_id = ANY(${dArr})`);
  if (doomedHashes.length) {
    await tx.execute(sql`DELETE FROM api_file_embedded_media WHERE from_file_id = ANY(${dArr}) OR to_file_id = ANY(${dArr})`);
    await tx.execute(sql`DELETE FROM api_metadatafile WHERE file_id = ANY(${dArr})`);
    await tx.execute(sql`UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ANY(${dArr})`);
    await tx.execute(sql`DELETE FROM api_file WHERE hash = ANY(${dArr})`);
  }
  await tx.execute(sql`UPDATE api_photo SET main_file_id = NULL, removed = TRUE, last_modified = now() WHERE id = ANY(${idArr})`);
  await tx.execute(sql`DELETE FROM api_photo_stacks WHERE photo_id = ANY(${idArr})`);
  await tx.execute(sql`DELETE FROM api_photo_duplicates WHERE photo_id = ANY(${idArr})`);

  if (stacks.length) {
    const dead = (
      await rows<{ id: string }>(
        sql`SELECT s.v AS id FROM unnest(${pgArray(
          stacks.map((s) => s.id),
          "uuid",
        )}) AS s(v) WHERE (SELECT COUNT(*) FROM api_photo_stacks ps
          JOIN api_photo p ON p.id = ps.photo_id WHERE ps.photostack_id = s.v AND NOT p.removed) <= 1`,
        tx,
      )
    ).map((r) => r.id);
    if (dead.length) {
      const a = pgArray(dead, "uuid");
      await tx.execute(sql`DELETE FROM api_photo_stacks WHERE photostack_id = ANY(${a})`);
      await tx.execute(sql`DELETE FROM api_stackreview WHERE stack_id = ANY(${a})`);
      await tx.execute(sql`DELETE FROM api_photostack WHERE id = ANY(${a})`);
    }
  }
  if (dups.length) {
    const dead = (
      await rows<{ id: string }>(
        sql`SELECT d.v AS id FROM unnest(${pgArray(
          dups.map((s) => s.id),
          "uuid",
        )}) AS d(v) WHERE (SELECT COUNT(*) FROM api_photo_duplicates pd
          JOIN api_photo p ON p.id = pd.photo_id WHERE pd.duplicate_id = d.v AND NOT p.removed) <= 1`,
        tx,
      )
    ).map((r) => r.id);
    if (dead.length) {
      const a = pgArray(dead, "uuid");
      await tx.execute(sql`DELETE FROM api_photo_duplicates WHERE duplicate_id = ANY(${a})`);
      await tx.execute(sql`DELETE FROM api_duplicate WHERE id = ANY(${a})`);
    }
  }

  const files = doomed.map((d) => d.path ?? "").filter(Boolean);
  const transcoded = path.join(config.mediaRoot, "transcoded");
  for (const { image_hash: h } of hashes) {
    if (!h) continue;
    files.push(path.join(transcoded, `${h}.mp4.part`), path.join(transcoded, `${h}.mp4`));
  }
  return files;
}

async function unlinkAll(files: string[]) {
  await Promise.all(files.map((f) => rm(f, { force: true }).catch((e) => console.warn(`could not delete ${f}: ${e}`))));
}

export async function deletePhotos(user: User, raw: unknown) {
  const body = object(raw);
  const sel = selection(body, true);
  if (sel.kind === "all") {
    let n = 0;
    const files = await db.transaction(async (tx) => {
      const ids = (
        await rows<{ id: string }>(sql`SELECT p.id FROM api_photo p WHERE ${selectAllWhere(user, sel.params, sel.excluded)} ORDER BY p.id`, tx)
      ).map((r) => r.id);
      n = ids.length;
      return removePhotos(tx, ids);
    });
    await unlinkAll(files);
    return { status: true, count: n, failed_count: 0 };
  }
  const unique = uniq(sel.hashes);
  let deleted: string[] = [];
  let notDeleted: string[] = [];
  const files = await db.transaction(async (tx) => {
    const found = await rows<{ id: string; image_hash: string }>(
      sql`SELECT p.id, p.image_hash FROM api_photo p
        WHERE ${ownedBy("p", user.id)} AND p.in_trashcan AND p.image_hash = ANY(${pgArray(unique, "text")}) ORDER BY p.id`,
      tx,
    );
    const have = new Set(found.map((r) => r.image_hash));
    deleted = unique.filter((h) => have.has(h));
    notDeleted = unique.filter((h) => !have.has(h));
    return removePhotos(
      tx,
      found.map((r) => r.id),
    );
  });
  await unlinkAll(files);
  return { status: true, results: deleted, not_deleted: notDeleted, deleted };
}
