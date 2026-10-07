// Duplicate groups (api/views/duplicates.py, api/models/duplicate.py): list,
// detail, stats, detect, resolve, dismiss, revert, delete, plus the
// create_or_merge writes of the detection job. Port of
// lp_api::stats_admin_stacks_dupes::dupes, lp_db's duplicate reads and
// lp_db::write::stats_admin_stacks_dupes::dupes. Membership is the
// api_photo_duplicates link table.
import { sql } from "drizzle-orm";
import { db, pgArray, row, rows, type Db, type Tx } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import { pyTruthy, type QueryMap } from "~/lib/query";
import { ownedBy } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import { bigThumbnailUrl, field, fileTypeDisplay, jsonInt, Paging, parseId, pyRound, pyStr, smallThumbnailUrl } from "./common";
import { byGroup, members, photoRef, totalPhotos } from "./members";

const NOT_FOUND = "Duplicate group not found";
export const DUPES_DETECT = "dupes.detect";
export const EXACT_COPY = "exact_copy";
export const VISUAL_DUPLICATE = "visual_duplicate";

const typeDisplay = (t: string) => ({ exact_copy: "Exact Copies", visual_duplicate: "Visual Duplicates" })[t] ?? t;
const statusDisplay = (s: string) => ({ pending: "Pending Review", resolved: "Resolved", dismissed: "Dismissed" })[s] ?? s;

interface DuplicateRow {
  id: string;
  duplicate_type: string;
  review_status: string;
  photo_count: number;
  potential_savings: number;
  similarity_score: number | null;
  created_at: string;
  updated_at: string;
  kept_hash: string | null;
  kept_thumb_small: string | null;
}

const dupsCte = (owner: number) =>
  sql`WITH dups AS (SELECT d.*, (SELECT count(*)::int FROM api_photo_duplicates x WHERE x.duplicate_id = d.id) AS photo_count
    FROM api_duplicate d WHERE d.owner_id = ${owner}) `;

const DUP_SELECT = sql`SELECT d.id, d.duplicate_type, d.review_status, d.photo_count, d.potential_savings::float8 AS potential_savings,
    d.similarity_score, ${drfTs("d.created_at")} AS created_at, ${drfTs("d.updated_at")} AS updated_at,
    kp.image_hash AS kept_hash, kth.square_thumbnail_small AS kept_thumb_small
  FROM dups d LEFT JOIN api_photo kp ON kp.id = d.kept_photo_id
  LEFT JOIN api_thumbnail kth ON kth.photo_id = kp.id`;

const filters = (type: string | undefined, status: string | undefined) =>
  sql` WHERE d.photo_count >= 2${type === undefined ? sql`` : sql` AND d.duplicate_type = ${type}`}${
    status === undefined ? sql`` : sql` AND d.review_status = ${status}`
  }`;

export async function listDuplicates(userId: number, q: QueryMap) {
  const paging = new Paging(q);
  const type = q.nonEmpty("duplicate_type");
  const status = q.nonEmpty("status");
  const count = (await row<{ n: number }>(sql`${dupsCte(userId)}SELECT count(*)::int AS n FROM dups d${filters(type, status)}`))!.n;
  const rs = await rows<DuplicateRow>(
    sql`${dupsCte(userId)}${DUP_SELECT}${filters(type, status)} ORDER BY d.created_at DESC, d.id LIMIT ${paging.pageSize} OFFSET ${paging.offset(count)}`,
  );
  const previews = byGroup(await members("api_photo_duplicates", rs.map((r) => r.id), 4));
  return paging.envelope(
    count,
    rs.map((r) => ({
      id: r.id,
      duplicate_type: r.duplicate_type,
      duplicate_type_display: typeDisplay(r.duplicate_type),
      review_status: r.review_status,
      review_status_display: statusDisplay(r.review_status),
      photo_count: r.photo_count,
      potential_savings: r.potential_savings,
      similarity_score: r.similarity_score,
      created_at: r.created_at,
      kept_photo: r.kept_hash === null ? null : photoRef({ image_hash: r.kept_hash, thumb_small: r.kept_thumb_small }),
      preview_photos: (previews.get(r.id) ?? []).map(photoRef),
    })),
  );
}

const getDup = (owner: number, id: string, tx: Db | Tx = db) => row<DuplicateRow>(sql`${dupsCte(owner)}${DUP_SELECT} WHERE d.id = ${id}`, tx);

/**
 * (join, key) of auto_select_best_photo over photo alias p: exact copies keep
 * the shortest main file path, visual duplicates the largest resolution
 * (DESC puts NULLs first, like Django's `.last()` of the ascending order).
 */
function bestKey(type: string) {
  return type === EXACT_COPY
    ? { join: sql.raw("LEFT JOIN api_file mf ON mf.hash = p.main_file_id"), key: sql.raw("length(mf.path) ASC") }
    : { join: sql.raw("LEFT JOIN api_photometadata m ON m.photo_id = p.id"), key: sql.raw("(m.width * m.height) DESC") };
}

/**
 * Duplicate.auto_select_best_photo. Ties go to the earliest link: Django's
 * plan meets the links in insertion order and its top-1 sort keeps the
 * first maximum; create_or_merge links photos in Django's order.
 */
async function bestPhoto(id: string, type: string, tx: Db | Tx = db) {
  const { join, key } = bestKey(type);
  return row<{ id: string; image_hash: string }>(
    sql`SELECT p.id, p.image_hash FROM api_photo p INNER JOIN api_photo_duplicates x ON (p.id = x.photo_id) ${join}
      WHERE x.duplicate_id = ${id} ORDER BY ${key}, x.id LIMIT 1`,
    tx,
  );
}

export async function duplicateDetail(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const [dup, ms] = await Promise.all([getDup(userId, id), members("api_photo_duplicates", [id], null)]);
  if (!dup) throw ApiError.notFound(NOT_FOUND);
  const suggested = await bestPhoto(id, dup.duplicate_type);
  return {
    id: dup.id,
    duplicate_type: dup.duplicate_type,
    duplicate_type_display: typeDisplay(dup.duplicate_type),
    review_status: dup.review_status,
    review_status_display: statusDisplay(dup.review_status),
    photo_count: dup.photo_count,
    potential_savings: dup.potential_savings,
    similarity_score: dup.similarity_score,
    created_at: dup.created_at,
    updated_at: dup.updated_at,
    kept_photo_hash: dup.kept_hash,
    suggested_photo_hash: suggested?.image_hash ?? null,
    photos: ms.map((m) => ({
      id: m.id,
      image_hash: m.image_hash,
      width: m.width,
      height: m.height,
      size: m.size,
      camera: m.camera,
      exif_timestamp: m.exif_timestamp,
      // Null (not false) when nothing was kept yet, as Django answers.
      is_kept: dup.kept_hash === null ? null : dup.kept_hash === m.image_hash,
      file_path: m.main_file_path,
      file_type: m.main_file_type === null ? null : fileTypeDisplay(m.main_file_type),
      thumbnail_url: smallThumbnailUrl(m.image_hash, m.thumb_small),
      thumbnail_big_url: bigThumbnailUrl(m.image_hash, m.thumb_big),
    })),
  };
}

export async function duplicateStats(userId: number) {
  const s = (await row<{
    total_duplicates: number;
    exact_copy: number;
    visual_duplicate: number;
    pending: number;
    resolved: number;
    dismissed: number;
    pending_savings: number | null;
    photos_in_duplicates: number;
    total_photos: number;
  }>(sql`SELECT count(*)::int AS total_duplicates,
      count(*) FILTER (WHERE duplicate_type = 'exact_copy')::int AS exact_copy,
      count(*) FILTER (WHERE duplicate_type = 'visual_duplicate')::int AS visual_duplicate,
      count(*) FILTER (WHERE review_status = 'pending')::int AS pending,
      count(*) FILTER (WHERE review_status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE review_status = 'dismissed')::int AS dismissed,
      sum(potential_savings) FILTER (WHERE review_status = 'pending')::float8 AS pending_savings,
      (SELECT count(*)::int FROM api_photo p WHERE EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.photo_id = p.id)
         AND ${ownedBy("p", userId)}) AS photos_in_duplicates,
      ${totalPhotos(ownedBy("p", userId))} AS total_photos
    FROM api_duplicate WHERE owner_id = ${userId}`))!;
  const savings = s.pending_savings ?? 0;
  return {
    total_duplicates: s.total_duplicates,
    pending_duplicates: s.pending,
    resolved_duplicates: s.resolved,
    dismissed_duplicates: s.dismissed,
    by_type: { exact_copy: s.exact_copy, visual_duplicate: s.visual_duplicate },
    photos_in_duplicates: s.photos_in_duplicates,
    total_photos: s.total_photos,
    potential_savings_bytes: savings,
    potential_savings_mb: savings === 0 ? 0 : pyRound(savings / (1024 * 1024), 2),
  };
}

/** POST /api/duplicates/detect: queue dupes.detect. */
export async function detectDuplicates(userId: number, body: unknown) {
  const intField = (key: string, def: number) => {
    const v = field(body, key);
    if (v === undefined) return def;
    const n = jsonInt(v);
    if (n === undefined) throw ApiError.badRequest(key, "A valid integer is required.");
    return n;
  };
  const or = (key: string, def: unknown) => {
    const v = field(body, key);
    return v === undefined ? def : v;
  };
  const batchSize = Math.min(50000, Math.max(100, intField("batch_size", 10000)));
  const options = {
    detect_exact_copies: or("detect_exact_copies", true),
    detect_visual_duplicates: or("detect_visual_duplicates", true),
    visual_threshold: intField("visual_threshold", 10),
    clear_pending: or("clear_pending", false),
    batch_size: batchSize,
  };
  await enqueue(DUPES_DETECT, { user_id: userId, options }, { lrj: { jobType: JobType.DetectDuplicates, userId } });
  return json({ status: "queued", message: "Duplicate detection started", options }, 202);
}

// ------------------------------------------------------------------ writes

const ownedStatus = (tx: Tx, owner: number, id: string) =>
  row<{ review_status: string; trashed_count: number }>(
    sql`SELECT review_status, trashed_count FROM api_duplicate WHERE id = ${id} AND owner_id = ${owner} FOR UPDATE`,
    tx,
  );

async function deleteGroups(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const arr = pgArray(ids, "uuid");
  await tx.execute(sql`DELETE FROM api_photo_duplicates WHERE duplicate_id = ANY(${arr})`);
  await tx.execute(sql`DELETE FROM api_duplicate WHERE id = ANY(${arr})`);
}

/** refresh_tag_photo_counts: recount the visible photos of every tag holding one of photoIds. */
async function refreshTagsForPhotos(tx: Tx, photoIds: string[]) {
  if (!photoIds.length) return;
  await tx.execute(sql`UPDATE api_tag t SET photo_count = COALESCE((SELECT count(*) FROM api_tag_photos tp
      JOIN api_photo p ON p.id = tp.photo_id WHERE tp.tag_id = t.id
      AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), 0)
    WHERE t.id IN (SELECT tag_id FROM api_tag_photos WHERE photo_id = ANY(${pgArray(photoIds, "uuid")}))`);
}

/** DELETE /api/duplicates/{id}/delete: the number of photos unlinked. */
export async function deleteDuplicate(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const n = await db.transaction(async (tx) => {
    if (!(await ownedStatus(tx, userId, id))) return null;
    const n = (await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_photo_duplicates WHERE duplicate_id = ${id}`, tx))!.n;
    await deleteGroups(tx, [id]);
    return n;
  });
  if (n === null) throw ApiError.notFound(NOT_FOUND);
  return { status: "deleted", unlinked_count: n };
}

export async function dismissDuplicate(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const ok = await db.transaction(async (tx) => {
    if (!(await ownedStatus(tx, userId, id))) return false;
    await tx.execute(sql`DELETE FROM api_photo_duplicates WHERE duplicate_id = ${id}`);
    await tx.execute(sql`UPDATE api_duplicate SET review_status = 'dismissed', reviewed_at = now(), updated_at = now() WHERE id = ${id}`);
    return true;
  });
  if (!ok) throw ApiError.notFound(NOT_FOUND);
  return { status: "dismissed" };
}

/**
 * POST /api/duplicates/{id}/revert: restore the group's trashed photos and
 * reset it to pending. Unlike Django, the restored photos' tag counts are
 * refreshed too (as in librephotos-rs).
 */
export async function revertDuplicate(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const r = await db.transaction(async (tx) => {
    const st = await ownedStatus(tx, userId, id);
    if (!st) return "not_found" as const;
    if (st.review_status !== "resolved") return "not_resolved" as const;
    const restored = await rows<{ id: string }>(
      sql`UPDATE api_photo p SET in_trashcan = FALSE, last_modified = now() WHERE p.in_trashcan
        AND p.id IN (SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = ${id}) RETURNING p.id`,
      tx,
    );
    await refreshTagsForPhotos(
      tx,
      restored.map((x) => x.id),
    );
    await tx.execute(sql`UPDATE api_duplicate SET review_status = 'pending', kept_photo_id = NULL, trashed_count = 0,
      reviewed_at = NULL, updated_at = now() WHERE id = ${id}`);
    return restored.length;
  });
  if (r === "not_found") throw ApiError.notFound(NOT_FOUND);
  if (r === "not_resolved") throw ApiError.badRequest("review_status", "Can only revert resolved duplicates");
  return { status: "reverted", restored_count: r };
}

/** POST /api/duplicates/{id}/resolve: keep one photo, optionally trash the rest. */
export async function resolveDuplicate(userId: number, rawId: string, body: unknown) {
  const id = parseId(rawId, NOT_FOUND);
  const keep = field(body, "keep_photo_hash");
  const trashRaw = field(body, "trash_others");
  const trashOthers = trashRaw === undefined || pyTruthy(trashRaw);
  if (!pyTruthy(keep)) {
    if (!(await getDup(userId, id))) throw ApiError.notFound(NOT_FOUND);
    throw ApiError.badRequest("keep_photo_hash", "keep_photo_hash is required");
  }
  const r = await db.transaction(async (tx) => {
    const st = await ownedStatus(tx, userId, id);
    if (!st) return "not_found" as const;
    const kept = await row<{ id: string }>(
      sql`SELECT p.id FROM api_photo_duplicates x JOIN api_photo p ON p.id = x.photo_id
        WHERE x.duplicate_id = ${id} AND p.image_hash = ${pyStr(keep)} ORDER BY x.id LIMIT 1`,
      tx,
    );
    if (!kept) return "not_in_group" as const;
    let trashedCount = st.trashed_count;
    if (trashOthers) {
      const trashed = await rows<{ id: string }>(
        sql`UPDATE api_photo p SET in_trashcan = TRUE, last_modified = now()
          WHERE p.id <> ${kept.id} AND p.id IN (SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = ${id}) RETURNING p.id`,
        tx,
      );
      await refreshTagsForPhotos(
        tx,
        trashed.map((x) => x.id),
      );
      trashedCount = trashed.length;
    }
    await tx.execute(sql`UPDATE api_duplicate SET kept_photo_id = ${kept.id}, review_status = 'resolved', reviewed_at = now(),
      trashed_count = ${trashedCount}, updated_at = now() WHERE id = ${id}`);
    return trashedCount;
  });
  if (r === "not_found") throw ApiError.notFound(NOT_FOUND);
  if (r === "not_in_group") throw ApiError.badRequest("keep_photo_hash", "Photo not found in this duplicate group");
  return { status: "resolved", kept_photo: keep, trashed_count: r };
}

// ------------------------------------------------- detection job writes

/** Duplicate.calculate_potential_savings: the size of every photo but the suggested one. */
async function calculatePotentialSavings(tx: Tx, id: string, type: string) {
  const best = await bestPhoto(id, type, tx);
  let savings = 0;
  if (best) {
    savings = (await row<{ s: number }>(
      sql`SELECT COALESCE(sum(p.size), 0)::float8 AS s FROM api_photo_duplicates x
        JOIN api_photo p ON p.id = x.photo_id WHERE x.duplicate_id = ${id} AND p.id <> ${best.id}`,
      tx,
    ))!.s;
  }
  await tx.execute(sql`UPDATE api_duplicate SET potential_savings = ${savings}, updated_at = now() WHERE id = ${id}`);
}

/** Link photos to a group unless already linked (M2M add), in the given order: link order breaks ties in bestPhoto. */
async function addDupPhotos(tx: Tx, group: string, photos: string[]) {
  const unique = [...new Set(photos)];
  await tx.execute(sql`INSERT INTO api_photo_duplicates (photo_id, duplicate_id)
    SELECT u.id, ${group}::uuid FROM unnest(${pgArray(unique, "uuid")}) WITH ORDINALITY AS u(id, n)
    WHERE NOT EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.duplicate_id = ${group} AND x.photo_id = u.id)
    ORDER BY u.n`);
}

/**
 * photos in the order Django's Photo.objects.filter(id__in=photos) yields
 * them, which is the order create_or_merge links them in. The planner
 * decides it (primary key order for a few ids, heap order from a bitmap scan
 * for more), so the statement is shaped like Django's.
 */
async function djangoOrder(tx: Tx, photos: string[]): Promise<string[]> {
  const rs = await rows<{ lp_order_id: string }>(sql`SELECT p.id AS lp_order_id, p.* FROM api_photo p WHERE p.id = ANY(${pgArray(photos, "uuid")})`, tx);
  const ordered = rs.map((r) => r.lp_order_id);
  // Photos without a row keep a place at the end (they fail the foreign key check, as in Django).
  const known = new Set(ordered);
  for (const p of photos) if (!known.has(p)) ordered.push(p);
  return ordered;
}

/** Whether djangoOrder's statement for photos is an index scan (primary key order). */
async function inListIsIndexScan(tx: Tx, photos: string[]): Promise<boolean> {
  const r = await row<Record<string, unknown>>(
    sql`EXPLAIN (FORMAT JSON) SELECT p.id AS lp_order_id, p.* FROM api_photo p WHERE p.id = ANY(${pgArray(photos, "uuid")})`,
    tx,
  );
  let plan = r ? Object.values(r)[0] : null;
  if (typeof plan === "string") plan = JSON.parse(plan);
  return (plan as { Plan?: { "Node Type"?: string } }[] | null)?.[0]?.Plan?.["Node Type"] === "Index Scan";
}

/** Duplicate.create_or_merge for 2+ photos: returns the group. */
async function createOrMerge(tx: Tx, owner: number, type: string, input: string[], similarity: number | null): Promise<string | null> {
  if (input.length < 2) return null;
  const photos = await djangoOrder(tx, input);
  const existing = await rows<{ id: string }>(
    sql`SELECT d.id FROM api_duplicate d WHERE d.owner_id = ${owner} AND d.duplicate_type = ${type}
      AND EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.duplicate_id = d.id AND x.photo_id = ANY(${pgArray(photos, "uuid")}))
      ORDER BY d.created_at DESC, d.id`,
    tx,
  );
  if (!existing.length) {
    const id = crypto.randomUUID();
    await tx.execute(sql`INSERT INTO api_duplicate (id, duplicate_type, review_status, created_at, updated_at,
        reviewed_at, similarity_score, potential_savings, trashed_count, note, kept_photo_id, owner_id)
      VALUES (${id}, ${type}, 'pending', now(), now(), NULL, ${similarity}::float8, 0, 0, NULL, NULL, ${owner})`);
    await addDupPhotos(tx, id, photos);
    await calculatePotentialSavings(tx, id, type);
    return id;
  }
  const target = existing[0].id;
  for (const { id: other } of existing.slice(1)) {
    const moved = await rows<{ photo_id: string }>(sql`SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = ${other} ORDER BY id`, tx);
    await addDupPhotos(
      tx,
      target,
      moved.map((m) => m.photo_id),
    );
    await calculatePotentialSavings(tx, target, type);
    await deleteGroups(tx, [other]);
  }
  await addDupPhotos(tx, target, photos);
  await calculatePotentialSavings(tx, target, type);
  return target;
}

/** Positions of the groups where two or more photos share the best key. */
async function tiedGroups(tx: Tx, type: string, groups: string[][]): Promise<number[]> {
  const { join, key } = bestKey(type);
  const pos: number[] = [];
  const photo: string[] = [];
  groups.forEach((g, n) => g.forEach((p) => (pos.push(n), photo.push(p))));
  const rs = await rows<{ n: number }>(
    sql`SELECT r.n FROM (SELECT l.n, rank() OVER (PARTITION BY l.n ORDER BY ${key}) AS r
        FROM unnest(${pgArray(pos, "int4")}, ${pgArray(photo, "uuid")}) AS l(n, photo_id)
        JOIN api_photo p ON p.id = l.photo_id ${join}) r
      WHERE r.r = 1 GROUP BY r.n HAVING count(*) > 1 ORDER BY r.n`,
    tx,
  );
  return rs.map((r) => r.n);
}

/**
 * createOrMerge over disjoint groups (union-find output) with the same
 * result as calling it once per group in order, in a fixed number of
 * statements: only groups sharing a photo with an existing group of this
 * type take the one-by-one merge path; every other group is new and cannot
 * meet another, so they are inserted and priced together. Returns how many
 * groups were created or merged into.
 */
export async function createOrMergeMany(tx: Tx, owner: number, type: string, input: string[][]): Promise<number> {
  const groups = input.filter((g) => g.length >= 2);
  if (!groups.length) return 0;
  const all = groups.flat();
  const grouped = new Set(
    (
      await rows<{ photo_id: string }>(
        sql`SELECT DISTINCT x.photo_id FROM api_photo_duplicates x JOIN api_duplicate d ON d.id = x.duplicate_id
          WHERE d.owner_id = ${owner} AND d.duplicate_type = ${type} AND x.photo_id = ANY(${pgArray(all, "uuid")})`,
        tx,
      )
    ).map((r) => r.photo_id),
  );
  const merging = groups.filter((g) => g.some((p) => grouped.has(p)));
  const fresh = groups.filter((g) => !g.some((p) => grouped.has(p)));
  let done = 0;
  for (const g of merging) if ((await createOrMerge(tx, owner, type, g, null)) !== null) done++;
  if (!fresh.length) return done;
  const ids = fresh.map(() => crypto.randomUUID());
  // One microsecond apart, so the list (newest first) shows them in reverse
  // creation order like Django's one-by-one creates.
  await tx.execute(sql`INSERT INTO api_duplicate (id, duplicate_type, review_status, created_at, updated_at,
      reviewed_at, similarity_score, potential_savings, trashed_count, note, kept_photo_id, owner_id)
    SELECT g.id, ${type}, 'pending', now() + g.n * interval '1 microsecond', now() + g.n * interval '1 microsecond',
      NULL, NULL, 0, 0, NULL, NULL, ${owner}
    FROM unnest(${pgArray(ids, "uuid")}) WITH ORDINALITY AS g(id, n) ORDER BY g.n`);
  const memberLists = fresh.map((g) => [...new Set(g)].sort());
  // Link order only matters where several photos tie for the suggested one;
  // those groups get Django's order (see djangoOrder). Its plan depends on
  // the number of ids alone: primary key order from an index scan, else heap order.
  const tied = await tiedGroups(tx, type, memberLists);
  const heapOrder: number[] = [];
  const planBySize = new Map<number, boolean>();
  for (const n of tied) {
    const k = memberLists[n].length;
    let indexOrder = planBySize.get(k);
    if (indexOrder === undefined) {
      indexOrder = await inListIsIndexScan(tx, memberLists[n]);
      planBySize.set(k, indexOrder);
    }
    if (!indexOrder) heapOrder.push(n);
  }
  if (heapOrder.length) {
    const pos: number[] = [];
    const photo: string[] = [];
    for (const n of heapOrder) for (const p of memberLists[n]) pos.push(n), photo.push(p);
    const rs = await rows<{ n: number; id: string }>(
      sql`SELECT l.n, p.id FROM unnest(${pgArray(pos, "int4")}, ${pgArray(photo, "uuid")}) AS l(n, photo_id)
        JOIN api_photo p ON p.id = l.photo_id ORDER BY l.n, p.ctid`,
      tx,
    );
    for (const n of heapOrder) memberLists[n] = [];
    for (const r of rs) memberLists[r.n].push(r.id);
  }
  const linkDup: string[] = [];
  const linkPhoto: string[] = [];
  memberLists.forEach((m, i) => m.forEach((p) => (linkDup.push(ids[i]), linkPhoto.push(p))));
  await tx.execute(sql`INSERT INTO api_photo_duplicates (photo_id, duplicate_id)
    SELECT l.photo_id, l.dup FROM unnest(${pgArray(linkDup, "uuid")}, ${pgArray(linkPhoto, "uuid")}) WITH ORDINALITY AS l(dup, photo_id, n)
    ORDER BY l.n`);
  const { join, key } = bestKey(type);
  await tx.execute(sql`UPDATE api_duplicate d SET potential_savings = s.savings, updated_at = now()
    FROM (SELECT b.id, COALESCE((SELECT sum(p.size) FROM api_photo_duplicates x
            JOIN api_photo p ON p.id = x.photo_id
            WHERE x.duplicate_id = b.id AND p.id <> b.best), 0)::bigint AS savings
          FROM (SELECT g.id, (SELECT p.id FROM api_photo p
                  JOIN api_photo_duplicates x ON x.photo_id = p.id ${join}
                  WHERE x.duplicate_id = g.id ORDER BY ${key}, x.id LIMIT 1) AS best
                FROM unnest(${pgArray(ids, "uuid")}) AS g(id)) b) s
    WHERE d.id = s.id`);
  return done + ids.length;
}

/** clear_pending: delete the user's pending groups. */
export async function clearPending(tx: Tx, owner: number): Promise<number> {
  const ids = (await rows<{ id: string }>(sql`SELECT id FROM api_duplicate WHERE owner_id = ${owner} AND review_status = 'pending'`, tx)).map((r) => r.id);
  await deleteGroups(tx, ids);
  return ids.length;
}
