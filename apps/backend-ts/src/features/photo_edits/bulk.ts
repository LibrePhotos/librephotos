// BulkPhotoMutationView and its subclasses (/photosedit/favorite, hide,
// setdeleted, makepublic) plus SetPhotosShared (/photosedit/share): one flag
// on many of the requester's photos in one UPDATE (port of
// lp_api::photo_edits::bulk and lp_db::write::photo_edits::{bulk, sharing}).
import { sql, type SQL } from "drizzle-orm";
import { ApiError } from "~/lib/errors";
import { db, pgArray, rows, type Tx } from "~/lib/db";
import { wakeWorker } from "~/lib/jobs";
import { pyTruthy } from "~/lib/query";
import { ownedBy } from "~/lib/scope";
import type { User } from "~/lib/users";
import {
  enqueueManyTx,
  metadataToDisk,
  modelBool,
  object,
  required,
  selectAllWhere,
  selection,
  uniq,
  type Selection,
} from "./common";

export type Flag = "deleted" | "favorite" | "hidden" | "public";

const COLUMN: Record<Exclude<Flag, "favorite">, string> = { deleted: "in_trashcan", hidden: "hidden", public: "public" };

/** `differs(user, value)` over alias p. */
function differs(flag: Flag, value: boolean, minRating: number): SQL {
  if (flag === "favorite") return value ? sql`(p.rating < ${minRating})` : sql`(p.rating >= ${minRating})`;
  return sql`(p.${sql.raw(COLUMN[flag])} <> ${value})`;
}

/** `new_values(user, value)` as a SET clause. */
function setClause(flag: Flag, value: boolean, minRating: number): SQL {
  if (flag === "favorite") return sql`rating = ${value ? minRating : 0}`;
  return sql`${sql.raw(COLUMN[flag])} = ${value}`;
}

/** refresh_tag_photo_counts: recount the tags' visible photos (no last_modified bump). */
export async function refreshTagPhotoCounts(tx: Tx, tagIds: number[]): Promise<void> {
  if (!tagIds.length) return;
  await tx.execute(sql`UPDATE api_tag AS t SET photo_count = COALESCE((
      SELECT COUNT(tp.id) FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id
      WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), 0)
    WHERE t.id = ANY(${pgArray(tagIds, "int")})`);
}

export async function tagIdsForPhotos(tx: Tx, photoIds: string[]): Promise<number[]> {
  const r = await rows<{ tag_id: number }>(
    sql`SELECT DISTINCT tag_id FROM api_tag_photos WHERE photo_id = ANY(${pgArray(photoIds, "uuid")})`,
    tx,
  );
  return r.map((x) => x.tag_id);
}

async function update(tx: Tx, flag: Flag, value: boolean, minRating: number, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const refreshesTags = flag === "deleted" || flag === "hidden";
  const tagIds = refreshesTags ? await tagIdsForPhotos(tx, ids) : [];
  if (flag === "deleted" && !value) {
    // A restored photo re-enters its stacks: their reviews go back to pending.
    await tx.execute(sql`UPDATE api_stackreview SET decision = 'pending' WHERE decision = 'resolved'
      AND stack_id IN (SELECT photostack_id FROM api_photo_stacks WHERE photo_id = ANY(${pgArray(ids, "uuid")}))`);
  }
  const r = await rows<{ n: number }>(
    sql`WITH u AS (UPDATE api_photo SET ${setClause(flag, value, minRating)}, last_modified = now()
      WHERE id = ANY(${pgArray(ids, "uuid")}) RETURNING 1) SELECT count(*)::int AS n FROM u`,
    tx,
  );
  await refreshTagPhotoCounts(tx, tagIds);
  return r[0]?.n ?? 0;
}

interface Outcome {
  count: number;
  hashes?: { updated: string[]; notUpdated: string[] };
  touched: string[];
}

async function apply(tx: Tx, user: User, flag: Flag, value: boolean, sel: Selection): Promise<Outcome> {
  const min = user.favoriteMinRating;
  if (sel.kind === "all") {
    const onlyChanged = flag === "favorite" ? sql` AND ${differs(flag, value, min)}` : sql``;
    const ids = (
      await rows<{ id: string }>(sql`SELECT p.id FROM api_photo p WHERE ${selectAllWhere(user, sel.params, sel.excluded)}${onlyChanged}`, tx)
    ).map((r) => r.id);
    const count = await update(tx, flag, value, min, ids);
    return { count, touched: ids };
  }
  const found = await rows<{ id: string; image_hash: string; changing: boolean }>(
    sql`SELECT p.id, p.image_hash, ${differs(flag, value, min)} AS changing FROM api_photo p
      WHERE ${ownedBy("p", user.id)} AND p.image_hash = ANY(${pgArray(sel.hashes, "text")})`,
    tx,
  );
  const present = new Set(found.map((r) => r.image_hash));
  const changing = new Set(found.filter((r) => r.changing).map((r) => r.image_hash));
  const unique = uniq(sel.hashes);
  const updated = unique.filter((h) => changing.has(h));
  const notUpdated = unique.filter((h) => present.has(h) && !changing.has(h));
  // Every owned row carrying an updated hash, as Django re-filters by hash.
  const ids = found.filter((r) => changing.has(r.image_hash)).map((r) => r.id);
  await update(tx, flag, value, min, ids);
  return { count: updated.length, hashes: { updated, notUpdated }, touched: ids };
}

/** POST /photosedit/{favorite,hide,setdeleted,makepublic}/ */
export async function bulkFlag(user: User, raw: unknown, flag: Flag, valueField: string) {
  const body = object(raw);
  const rawValue = required(body, valueField);
  let value: boolean;
  if (flag === "favorite") value = pyTruthy(rawValue);
  else {
    const b = modelBool(rawValue);
    if (b === undefined) throw ApiError.badRequest(valueField, "Must be a valid boolean.");
    value = b;
  }
  const sel = selection(body, false);
  let queued = false;
  const out = await db.transaction(async (tx) => {
    const o = await apply(tx, user, flag, value, sel);
    queued = flag === "favorite" && metadataToDisk(user) && o.touched.length > 0;
    if (queued) await enqueueManyTx(tx, "metadata.write", o.touched.map((id) => ({ photo_id: id, fields: ["rating"] })));
    return o;
  });
  if (queued) wakeWorker();
  if (!out.hashes) return { status: true, count: out.count };
  return { status: true, count: out.count, updated_hashes: out.hashes.updated, not_updated_hashes: out.hashes.notUpdated };
}

/** POST /photosedit/share/ (SetPhotosShared): add or remove target_user_id on the requester's photos. */
export async function sharePhotos(user: User, raw: unknown) {
  const body = object(raw);
  // `if shared:` on the raw value.
  const shared = pyTruthy(required(body, "val_shared"));
  const target = required(body, "target_user_id");
  let targetId: number | undefined;
  if (typeof target === "number" && Number.isInteger(target)) targetId = target;
  else if (typeof target === "string" && /^[+-]?\d+$/.test(target.trim())) targetId = Number(target.trim());
  if (targetId === undefined || targetId > 2147483647 || targetId < -2147483648)
    throw ApiError.badRequest("target_user_id", "A valid integer is required.");
  const sel = selection(body, false);
  const scope =
    sel.kind === "hashes"
      ? sql`SELECT unnest(${pgArray(sel.hashes, "text")})`
      : sql`SELECT p.image_hash FROM api_photo p WHERE ${selectAllWhere(user, sel.params, sel.excluded)}`;
  const tid = targetId;
  const count = await db.transaction(async (tx) => {
    const ids = (
      await rows<{ id: string }>(sql`SELECT p.id FROM api_photo p WHERE ${ownedBy("p", user.id)} AND p.image_hash IN (${scope})`, tx)
    ).map((r) => r.id);
    if (shared) {
      const created = (
        await rows<{ photo_id: string }>(
          sql`INSERT INTO api_photo_shared_to (photo_id, user_id)
            SELECT x.v, ${tid} FROM unnest(${pgArray(ids, "uuid")}) WITH ORDINALITY AS x(v, ord)
            WHERE NOT EXISTS (SELECT 1 FROM api_photo_shared_to s WHERE s.photo_id = x.v AND s.user_id = ${tid})
            ORDER BY x.ord RETURNING photo_id`,
          tx,
        )
      ).map((r) => r.photo_id);
      if (created.length) {
        await bump(tx, created);
        // A re-shared photo must not be shadowed by the recipient's stale tombstone on the next pull.
        await tx.execute(sql`DELETE FROM api_deletionlog WHERE entity = 'photo'
          AND entity_id = ANY(${pgArray(created, "text")}) AND owner_id = ${tid}`);
      }
      return created.length;
    }
    const del = await rows<{ n: number }>(
      sql`WITH d AS (DELETE FROM api_photo_shared_to WHERE user_id = ${tid} AND photo_id = ANY(${pgArray(ids, "uuid")}) RETURNING 1)
        SELECT count(*)::int AS n FROM d`,
      tx,
    );
    if (ids.length) {
      await bump(tx, ids);
      // Visibility loss: one tombstone per selected photo for the recipient,
      // shared or not (Django's bulk_create). clock_timestamp(): each sorts
      // after the last_modified bumps of this request.
      await tx.execute(sql`INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at)
        SELECT 'photo', x::text, ${tid}, clock_timestamp()
        FROM unnest(${pgArray(ids, "uuid")}) WITH ORDINALITY AS t(x, n) ORDER BY n`);
    }
    return del[0]?.n ?? 0;
  });
  return { status: true, count };
}

async function bump(tx: Tx, ids: string[]) {
  await tx.execute(sql`UPDATE api_photo SET last_modified = now() WHERE id = ANY(${pgArray(ids, "uuid")})`);
}
