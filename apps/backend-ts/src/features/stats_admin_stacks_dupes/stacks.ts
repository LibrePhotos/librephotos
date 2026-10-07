// Photo stacks (api/views/stacks.py, api/models/photo_stack.py): list,
// detail, stats, delete, add, remove, merge, manual, detect, primary. Port of
// lp_api::stats_admin_stacks_dupes::stacks, lp_db's stack reads and
// lp_db::write::stats_admin_stacks_dupes::stacks. Membership is the
// api_photo_stacks link table (no unique pair); deleting a stack also
// deletes its api_stackreview rows (Django CASCADE).
import { sql } from "drizzle-orm";
import { db, pgArray, row, rows, type Tx } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import { pyTruthy, type QueryMap } from "~/lib/query";
import { ownedBy } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import { bigThumbnailUrl, field, fileTypeDisplay, hashList, Paging, parseId, pyStr, smallThumbnailUrl } from "./common";
import { byGroup, members, photoRef, totalPhotos } from "./members";

const NOT_FOUND = "Photo stack not found";
export const STACKS_DETECT = "stacks.detect";

/** PhotoStack.VALID_STACK_TYPES */
export const VALID_TYPES = ["burst", "bracket", "manual"];
/** Valid plus the deprecated raw_jpeg / live_photo, in StackType order. */
const ALL_TYPES = ["burst", "bracket", "manual", "raw_jpeg", "live_photo"];
export const MANUAL = "manual";
export const BURST = "burst";

/** get_stack_type_display() */
const typeDisplay = (t: string) =>
  ({
    burst: "Burst Sequence",
    bracket: "Exposure Bracket",
    manual: "Manual Stack",
    raw_jpeg: "RAW + JPEG Pair (Deprecated)",
    live_photo: "Live Photo (Deprecated)",
  })[t] ?? t;

interface StackRow {
  id: string;
  stack_type: string;
  sequence_start: string | null;
  sequence_end: string | null;
  created_at: string;
  updated_at: string;
  photo_count: number;
  primary_hash: string | null;
  primary_thumb_small: string | null;
}

const stacksCte = (owner: number, types: string[]) =>
  sql`WITH stacks AS (SELECT ps.*, (SELECT count(*)::int FROM api_photo_stacks x WHERE x.photostack_id = ps.id) AS photo_count
    FROM api_photostack ps WHERE ps.owner_id = ${owner} AND ps.stack_type = ANY(${pgArray(types, "text")}))`;

const STACK_SELECT = sql`SELECT s.id, s.stack_type, ${drfTs("s.sequence_start")} AS sequence_start,
    ${drfTs("s.sequence_end")} AS sequence_end, ${drfTs("s.created_at")} AS created_at, ${drfTs("s.updated_at")} AS updated_at,
    s.photo_count, pp.image_hash AS primary_hash, pth.square_thumbnail_small AS primary_thumb_small
  FROM stacks s LEFT JOIN api_photo pp ON pp.id = s.primary_photo_id
  LEFT JOIN api_thumbnail pth ON pth.photo_id = pp.id`;

export async function listStacks(userId: number, q: QueryMap) {
  const paging = new Paging(q);
  const t = q.nonEmpty("stack_type");
  const types = t !== undefined && VALID_TYPES.includes(t) ? [t] : VALID_TYPES;
  const count = (await row<{ n: number }>(sql`${stacksCte(userId, types)} SELECT count(*)::int AS n FROM stacks WHERE photo_count >= 2`))!.n;
  const rs = await rows<StackRow>(sql`${stacksCte(userId, types)} ${STACK_SELECT} WHERE s.photo_count >= 2
    ORDER BY s.created_at DESC, s.id LIMIT ${paging.pageSize} OFFSET ${paging.offset(count)}`);
  const previews = byGroup(await members("api_photo_stacks", rs.map((r) => r.id), 4));
  return paging.envelope(
    count,
    rs.map((r) => ({
      id: r.id,
      stack_type: r.stack_type,
      stack_type_display: typeDisplay(r.stack_type),
      photo_count: r.photo_count,
      sequence_start: r.sequence_start,
      sequence_end: r.sequence_end,
      created_at: r.created_at,
      primary_photo: r.primary_hash === null ? null : photoRef({ image_hash: r.primary_hash, thumb_small: r.primary_thumb_small }),
      preview_photos: (previews.get(r.id) ?? []).map(photoRef),
    })),
  );
}

/**
 * GET /api/stacks/{id}/. Legacy raw_jpeg / live_photo stacks, which Django
 * still shows, are a 404: the frontend's StackType rejects them. The stack,
 * its members and their files are fetched concurrently.
 */
export async function stackDetail(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const [stack, ms, files] = await Promise.all([
    row<StackRow>(sql`${stacksCte(userId, VALID_TYPES)} ${STACK_SELECT} WHERE s.id = ${id}`),
    members("api_photo_stacks", [id], null),
    rows<{ photo_id: string; hash: string; path: string; file_type: number }>(sql`SELECT pf.photo_id, f.hash, f.path, f.type AS file_type
      FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id
      WHERE pf.photo_id IN (SELECT photo_id FROM api_photo_stacks WHERE photostack_id = ${id}) ORDER BY pf.id`),
  ]);
  if (!stack) throw ApiError.notFound(NOT_FOUND);
  const mainOf = new Map(ms.map((m) => [m.id, m.main_file_hash]));
  const variants = new Map<string, { hash: string; path: string; type: string; is_main: boolean; filename: string | null }[]>();
  for (const f of files) {
    const v = {
      hash: f.hash,
      path: f.path,
      type: fileTypeDisplay(f.file_type).toLowerCase(),
      is_main: mainOf.get(f.photo_id) === f.hash,
      filename: f.path ? f.path.slice(f.path.lastIndexOf("/") + 1) : null,
    };
    const list = variants.get(f.photo_id);
    if (list) list.push(v);
    else variants.set(f.photo_id, [v]);
  }
  return {
    id: stack.id,
    stack_type: stack.stack_type,
    stack_type_display: typeDisplay(stack.stack_type),
    photo_count: stack.photo_count,
    sequence_start: stack.sequence_start,
    sequence_end: stack.sequence_end,
    created_at: stack.created_at,
    updated_at: stack.updated_at,
    primary_photo_hash: stack.primary_hash,
    photos: ms.map((m) => ({
      id: m.id,
      image_hash: m.image_hash,
      width: m.width,
      height: m.height,
      size: m.size,
      camera: m.camera,
      exif_timestamp: m.exif_timestamp,
      is_primary: stack.primary_hash === m.image_hash,
      file_path: m.main_file_path,
      file_type: m.main_file_type === null ? null : fileTypeDisplay(m.main_file_type).toLowerCase(),
      file_variants: variants.get(m.id) ?? null,
      thumbnail_url: smallThumbnailUrl(m.image_hash, m.thumb_small),
      thumbnail_big_url: bigThumbnailUrl(m.image_hash, m.thumb_big),
    })),
  };
}

export async function stackStats(userId: number) {
  const types = pgArray(ALL_TYPES, "text");
  const s = (await row<{ total_stacks: number; by_type: [string, number][]; photos_in_stacks: number; total_photos: number }>(sql`SELECT
      (SELECT count(*)::int FROM api_photostack WHERE owner_id = ${userId} AND stack_type = ANY(${types})) AS total_stacks,
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(stack_type, n)), '[]'::jsonb)
         FROM (SELECT stack_type, count(*) AS n FROM api_photostack WHERE owner_id = ${userId} AND stack_type = ANY(${types})
               GROUP BY stack_type) t) AS by_type,
      (SELECT count(DISTINCT p.id)::int FROM api_photo p JOIN api_photo_stacks x ON x.photo_id = p.id
         JOIN api_photostack s ON s.id = x.photostack_id WHERE s.stack_type = ANY(${types}) AND ${ownedBy("p", userId)}) AS photos_in_stacks,
      ${totalPhotos(ownedBy("p", userId))} AS total_photos`))!;
  const counts = new Map(s.by_type.map(([t, n]) => [t, Number(n)]));
  return {
    total_stacks: s.total_stacks,
    by_type: Object.fromEntries(ALL_TYPES.map((t) => [t, counts.get(t) ?? 0])),
    photos_in_stacks: s.photos_in_stacks,
    total_photos: s.total_photos,
  };
}

// ------------------------------------------------------------------ writes

async function ownedStackType(tx: Tx, owner: number, id: string): Promise<string | undefined> {
  const r = await row<{ stack_type: string }>(sql`SELECT stack_type FROM api_photostack WHERE id = ${id} AND owner_id = ${owner} FOR UPDATE`, tx);
  return r?.stack_type;
}

const exists = async (owner: number, id: string) =>
  (await row<{ e: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM api_photostack WHERE id = ${id} AND owner_id = ${owner}) AS e`))!.e;

const memberCount = async (tx: Tx, id: string) =>
  (await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_photo_stacks WHERE photostack_id = ${id}`, tx))!.n;

/** Unlink every photo and delete the stacks (and their reviews). */
async function deleteStacks(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const arr = pgArray(ids, "uuid");
  await tx.execute(sql`DELETE FROM api_photo_stacks WHERE photostack_id = ANY(${arr})`);
  await tx.execute(sql`DELETE FROM api_stackreview WHERE stack_id = ANY(${arr})`);
  await tx.execute(sql`DELETE FROM api_photostack WHERE id = ANY(${arr})`);
}

/**
 * PhotoStack.auto_select_primary: bursts and brackets take the middle photo
 * by timestamp, everything else the largest resolution
 * (`order_by(w*h).last()`). Ties are left to Postgres, with statements
 * shaped like Django's.
 */
async function autoSelectPrimary(tx: Tx, id: string, stackType: string) {
  let pick: { id: string } | undefined;
  if (stackType === BURST || stackType === "bracket") {
    const n = await memberCount(tx, id);
    pick = await row(
      sql`SELECT p.id FROM api_photo p INNER JOIN api_photo_stacks x ON (p.id = x.photo_id) WHERE x.photostack_id = ${id} ORDER BY p.exif_timestamp ASC LIMIT 1 OFFSET ${Math.floor(n / 2)}`,
      tx,
    );
  } else {
    pick = await row(
      sql`SELECT p.id FROM api_photo p INNER JOIN api_photo_stacks x ON (p.id = x.photo_id) LEFT OUTER JOIN api_photometadata m ON (p.id = m.photo_id) WHERE x.photostack_id = ${id} ORDER BY (m.width * m.height) DESC LIMIT 1`,
      tx,
    );
  }
  if (pick) await tx.execute(sql`UPDATE api_photostack SET primary_photo_id = ${pick.id}, updated_at = now() WHERE id = ${id}`);
}

/** Ids of owner's photos with one of hashes (owned_by(...).filter(image_hash__in=...)). */
async function ownedPhotosByHash(tx: Tx, owner: number, hashes: string[]): Promise<string[]> {
  const rs = await rows<{ id: string }>(
    sql`SELECT p.id FROM api_photo p WHERE p.image_hash = ANY(${pgArray(hashes, "text")}) AND ${ownedBy("p", owner)} ORDER BY p.id`,
    tx,
  );
  return rs.map((r) => r.id);
}

/**
 * Link photos to a stack unless already linked (M2M add). Photos deleted
 * meanwhile are skipped: burst detection reads its candidates before its
 * transaction.
 */
async function addPhotos(tx: Tx, stack: string, photos: string[]): Promise<number> {
  const r = await rows(
    sql`INSERT INTO api_photo_stacks (photo_id, photostack_id)
      SELECT DISTINCT ON (u.id) u.id, ${stack}::uuid FROM unnest(${pgArray(photos, "uuid")}) WITH ORDINALITY AS u(id, ord)
      WHERE NOT EXISTS (SELECT 1 FROM api_photo_stacks x WHERE x.photostack_id = ${stack} AND x.photo_id = u.id)
        AND EXISTS (SELECT 1 FROM api_photo p WHERE p.id = u.id)
      ORDER BY u.id RETURNING 1`,
    tx,
  );
  return r.length;
}

const hasPrimary = async (tx: Tx, id: string) =>
  (await row<{ h: boolean }>(sql`SELECT primary_photo_id IS NOT NULL AS h FROM api_photostack WHERE id = ${id}`, tx))!.h;

/** Move every photo of `other` into `target` and delete `other` (PhotoStack.merge_with). */
async function mergeInto(tx: Tx, target: string, targetType: string, other: string) {
  if (target === other) return;
  const photos = await rows<{ photo_id: string }>(sql`SELECT photo_id FROM api_photo_stacks WHERE photostack_id = ${other} ORDER BY id`, tx);
  await addPhotos(
    tx,
    target,
    photos.map((p) => p.photo_id),
  );
  if (!(await hasPrimary(tx, target))) await autoSelectPrimary(tx, target, targetType);
  await deleteStacks(tx, [other]);
}

async function insertStack(tx: Tx, owner: number, stackType: string, start: string | null, end: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await tx.execute(sql`INSERT INTO api_photostack (id, stack_type, created_at, updated_at, sequence_start, sequence_end, owner_id, primary_photo_id)
    VALUES (${id}, ${stackType}, now(), now(), ${start}::timestamptz, ${end}::timestamptz, ${owner}, NULL)`);
  return id;
}

/** clear_stacks_of_type: the number of stacks deleted. */
export async function clearType(tx: Tx, owner: number, stackType: string): Promise<number> {
  const ids = (await rows<{ id: string }>(sql`SELECT id FROM api_photostack WHERE owner_id = ${owner} AND stack_type = ${stackType}`, tx)).map(
    (r) => r.id,
  );
  await deleteStacks(tx, ids);
  return ids.length;
}

/** PhotoStack.create_or_merge for 2+ photos; datetimes are ISO strings. */
export async function createOrMerge(
  tx: Tx,
  owner: number,
  stackType: string,
  photos: string[],
  start: string | null,
  end: string | null,
): Promise<string | null> {
  if (photos.length < 2) return null;
  const existing = await rows<{ id: string }>(
    sql`SELECT s.id FROM api_photostack s WHERE s.owner_id = ${owner} AND s.stack_type = ${stackType}
      AND EXISTS (SELECT 1 FROM api_photo_stacks x WHERE x.photostack_id = s.id AND x.photo_id = ANY(${pgArray(photos, "uuid")}))
      ORDER BY s.created_at DESC, s.id`,
    tx,
  );
  if (!existing.length) {
    const id = await insertStack(tx, owner, stackType, start, end);
    await addPhotos(tx, id, photos);
    await autoSelectPrimary(tx, id, stackType);
    return id;
  }
  const target = existing[0].id;
  for (const other of existing.slice(1)) await mergeInto(tx, target, stackType, other.id);
  await addPhotos(tx, target, photos);
  if (start !== null && end !== null) {
    // LEAST/GREATEST skip NULLs: a missing bound takes the new one.
    await tx.execute(sql`UPDATE api_photostack SET sequence_start = LEAST(sequence_start, ${start}::timestamptz),
      sequence_end = GREATEST(sequence_end, ${end}::timestamptz), updated_at = now() WHERE id = ${target}`);
  }
  await autoSelectPrimary(tx, target, stackType);
  return target;
}

// ---------------------------------------------------------------- handlers

export async function deleteStack(userId: number, rawId: string) {
  const id = parseId(rawId, NOT_FOUND);
  const n = await db.transaction(async (tx) => {
    if ((await ownedStackType(tx, userId, id)) === undefined) return null;
    const n = await memberCount(tx, id);
    await deleteStacks(tx, [id]);
    return n;
  });
  if (n === null) throw ApiError.notFound(NOT_FOUND);
  return { status: "deleted", unlinked_count: n };
}

/** A missing field is a 400 only once the stack is known to exist. */
async function requireField(userId: number, id: string, ok: boolean, name: string) {
  if (ok) return;
  if (!(await exists(userId, id))) throw ApiError.notFound(NOT_FOUND);
  throw ApiError.badRequest(name, `${name} is required`);
}

export async function setPrimary(userId: number, rawId: string, body: unknown) {
  const id = parseId(rawId, NOT_FOUND);
  const raw = field(body, "photo_hash");
  await requireField(userId, id, pyTruthy(raw), "photo_hash");
  const hash = pyStr(raw);
  const outcome = await db.transaction(async (tx) => {
    if ((await ownedStackType(tx, userId, id)) === undefined) return "not_found";
    const photo = await row<{ id: string }>(
      sql`SELECT p.id FROM api_photo_stacks x JOIN api_photo p ON p.id = x.photo_id
        WHERE x.photostack_id = ${id} AND p.image_hash = ${hash} ORDER BY x.id LIMIT 1`,
      tx,
    );
    if (!photo) return "not_in_stack";
    await tx.execute(sql`UPDATE api_photostack SET primary_photo_id = ${photo.id}, updated_at = now() WHERE id = ${id}`);
    return "updated";
  });
  if (outcome === "not_found") throw ApiError.notFound(NOT_FOUND);
  if (outcome === "not_in_stack") throw ApiError.badRequest("photo_hash", "Photo not found in this stack");
  return { status: "updated", primary_photo_hash: hash };
}

/** POST /api/stacks/{id}/add/ (AddToStackView). */
export async function addToStack(userId: number, rawId: string, body: unknown) {
  const id = parseId(rawId, NOT_FOUND);
  const raw = field(body, "photo_hashes");
  await requireField(userId, id, pyTruthy(raw), "photo_hashes");
  const r = await db.transaction(async (tx) => {
    if ((await ownedStackType(tx, userId, id)) === undefined) return null;
    const photos = await ownedPhotosByHash(tx, userId, hashList(raw));
    const added = await addPhotos(tx, id, photos);
    return { added, total: await memberCount(tx, id) };
  });
  if (!r) throw ApiError.notFound(NOT_FOUND);
  return { status: "updated", added_count: r.added, total_count: r.total };
}

export async function removeFromStack(userId: number, rawId: string, body: unknown) {
  const id = parseId(rawId, NOT_FOUND);
  const raw = field(body, "photo_hashes");
  await requireField(userId, id, pyTruthy(raw), "photo_hashes");
  const hashes = hashList(raw);
  const r = await db.transaction(async (tx) => {
    const stackType = await ownedStackType(tx, userId, id);
    if (stackType === undefined) return null;
    const photos = await ownedPhotosByHash(tx, userId, hashes);
    const removed = (await row<{ n: number }>(
      sql`WITH gone AS (DELETE FROM api_photo_stacks WHERE photostack_id = ${id} AND photo_id = ANY(${pgArray(photos, "uuid")})
        RETURNING photo_id) SELECT count(DISTINCT photo_id)::int AS n FROM gone`,
      tx,
    ))!.n;
    const remaining = await memberCount(tx, id);
    if (remaining < 2) {
      await deleteStacks(tx, [id]);
      return { deleted: true, removed, remaining };
    }
    const primaryRemoved = (await row<{ e: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM api_photostack s JOIN api_photo p ON p.id = s.primary_photo_id
        WHERE s.id = ${id} AND p.image_hash = ANY(${pgArray(hashes, "text")})) AS e`,
      tx,
    ))!.e;
    if (primaryRemoved) await autoSelectPrimary(tx, id, stackType);
    return { deleted: false, removed, remaining };
  });
  if (!r) throw ApiError.notFound(NOT_FOUND);
  if (r.deleted) return { status: "deleted", removed_count: r.removed, message: "Stack deleted because fewer than 2 photos remain" };
  return { status: "updated", removed_count: r.removed, total_count: r.remaining };
}

/** POST /api/stacks/merge/: merge every manual stack holding one of the photos into the newest of them. */
export async function mergeStacks(userId: number, body: unknown) {
  const raw = field(body, "photo_hashes");
  if (!pyTruthy(raw)) throw ApiError.badRequest("photo_hashes", "photo_hashes is required");
  const hashes = hashList(raw);
  const r = await db.transaction(async (tx) => {
    const photos = await ownedPhotosByHash(tx, userId, hashes);
    if (photos.length !== hashes.length) return { kind: "not_found" as const };
    const stacks = await rows<{ id: string }>(
      sql`SELECT s.id FROM api_photostack s WHERE s.owner_id = ${userId} AND s.stack_type = 'manual'
        AND EXISTS (SELECT 1 FROM api_photo_stacks x WHERE x.photostack_id = s.id AND x.photo_id = ANY(${pgArray(photos, "uuid")}))
        ORDER BY s.created_at DESC, s.id FOR UPDATE`,
      tx,
    );
    if (!stacks.length) return { kind: "none" as const };
    const target = stacks[0].id;
    const others = stacks.slice(1);
    if (!others.length) return { kind: "single" as const, target, count: await memberCount(tx, target) };
    for (const o of others) await mergeInto(tx, target, MANUAL, o.id);
    if (!(await hasPrimary(tx, target))) await autoSelectPrimary(tx, target, MANUAL);
    return { kind: "merged" as const, target, count: await memberCount(tx, target), merged: others.length };
  });
  switch (r.kind) {
    case "not_found":
      throw ApiError.badRequest("photo_hashes", "Some photos not found");
    case "none":
      throw ApiError.badRequest("photo_hashes", "No manual stacks found containing selected photos");
    case "single":
      return { status: "no_merge_needed", stack_id: r.target, photo_count: r.count, message: "Only one stack found, nothing to merge" };
    case "merged":
      return { status: "merged", stack_id: r.target, photo_count: r.count, merged_count: r.merged };
  }
}

/** POST /api/stacks/manual/ */
export async function manualStack(userId: number, body: unknown) {
  const hashes = hashList(field(body, "photo_hashes"));
  if (hashes.length < 2) throw ApiError.badRequest("photo_hashes", "At least 2 unique photos required to create a stack");
  const r = await db.transaction(async (tx) => {
    const photos = await ownedPhotosByHash(tx, userId, hashes);
    if (photos.length !== hashes.length) return null;
    // The first photo (in photo order) already in a manual stack decides; of
    // its manual stacks the newest wins (PhotoStack.Meta.ordering).
    const existing = await row<{ id: string }>(
      sql`SELECT s.id FROM unnest(${pgArray(photos, "uuid")}) WITH ORDINALITY AS u(id, ord)
        JOIN api_photo_stacks x ON x.photo_id = u.id JOIN api_photostack s ON s.id = x.photostack_id
        WHERE s.stack_type = 'manual' ORDER BY u.ord, s.created_at DESC, s.id LIMIT 1`,
      tx,
    );
    const stack = existing?.id ?? (await insertStack(tx, userId, MANUAL, null, null));
    await addPhotos(tx, stack, photos);
    await autoSelectPrimary(tx, stack, MANUAL);
    return { stack, count: photos.length };
  });
  if (!r) throw ApiError.badRequest("photo_hashes", "Some photos not found");
  return json({ status: "created", stack_id: r.stack, photo_count: r.count }, 201);
}

/** POST /api/stacks/detect/: queue burst detection (stacks.detect). */
export async function detectStacks(userId: number, body: unknown) {
  const v = field(body, "detect_bursts");
  const options = { detect_bursts: v === undefined ? true : v };
  await enqueue(STACKS_DETECT, { user_id: userId, options }, { lrj: { jobType: JobType.DetectStacks, userId } });
  return json({ status: "queued", message: "Stack detection started", options }, 202);
}
