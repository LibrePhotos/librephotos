// Background jobs of this area: stacks.detect (burst detection,
// api/stack_detection.py) and dupes.detect (api/duplicate_detection.py).
// Payloads: {user_id, options} with the options the detect endpoints echo.
// Port of lp_api::stats_admin_stacks_dupes::jobs and lp_db's detect reads.
import os from "node:os";
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { db, row, rows, type Tx } from "~/lib/db";
import { lrjFail, lrjFinish, lrjSetResult, lrjStart, registerJob, type JobCtx } from "~/lib/jobs";
import { pyTruthy } from "~/lib/query";
import { ownedBy } from "~/lib/scope";
import {
  groupByTimestamp,
  groupByVisual,
  isBurstPhoto,
  isHard,
  isSoft,
  parseRules,
  readTags,
  requiredExifTags,
  type BurstCandidate,
  type ExifTags,
  type Rule,
} from "./burst";
import { jsonInt } from "./common";
import { clearPending, createOrMergeMany, DUPES_DETECT, EXACT_COPY, VISUAL_DUPLICATE } from "./dupes";
import { forEachVisualPair, UnionFind } from "./phash";
import { BURST, clearType, createOrMerge, STACKS_DETECT } from "./stacks";

/** Python truthiness of options.get(key, default). */
const optionFlag = (options: Record<string, unknown>, key: string, def: boolean) => (key in options ? pyTruthy(options[key]) : def);

/** job.set_result({stage, current, total, found}); best effort. */
async function progress(lrj: string | null, stage: string, current: number, total: number, found: number) {
  if (!lrj) return;
  await lrjSetResult(lrj, { stage, current, total, found }).catch((e) => console.warn("job progress", e));
}

/** Start the LongRunningJob, run body, then complete or fail it. */
async function run(ctx: JobCtx, body: (userId: number, options: Record<string, unknown>, lrj: string | null) => Promise<unknown>) {
  const userId = ctx.payload?.user_id;
  if (typeof userId !== "number") throw new Error("payload without user_id");
  const options = ctx.payload?.options && typeof ctx.payload.options === "object" ? ctx.payload.options : {};
  const lrj = ctx.lrjId;
  if (lrj) await lrjStart(lrj);
  try {
    const result = await body(userId, options, lrj);
    if (lrj) await lrjFinish(lrj, result);
  } catch (e) {
    if (lrj) await lrjFail(lrj, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function requireUser(userId: number) {
  const u = await row<{ rules: unknown }>(sql`SELECT burst_detection_rules AS rules FROM api_user WHERE id = ${userId}`);
  if (!u) throw new Error(`user ${userId} not found`);
  return u;
}

// ---------------------------------------------------------- stacks.detect

const BURST_SELECT = sql`SELECT p.id,
    (extract(epoch FROM p.exif_timestamp) * 1000000)::float8 AS ts_us,
    to_char(p.exif_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_iso,
    (extract(epoch FROM p.added_on) * 1000000)::float8 AS added_us,
    mf.path AS main_file_path, (m.id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, p.perceptual_hash
  FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id
  LEFT JOIN api_photometadata m ON m.photo_id = p.id
  WHERE NOT p.hidden AND NOT p.in_trashcan AND `;

/** _create_burst_stack over a transaction: skips photos already in a burst stack. */
class Stacker {
  stacked = new Set<string>();
  created = 0;
  constructor(
    private tx: Tx,
    private owner: number,
  ) {}
  async create(photos: BurstCandidate[]) {
    const fresh = photos.filter((p) => !this.stacked.has(p.id));
    if (fresh.length < 2) return;
    const ids = fresh.map((p) => p.id);
    if ((await createOrMerge(this.tx, this.owner, BURST, ids, fresh[0].ts_iso, fresh[fresh.length - 1].ts_iso)) !== null) {
      this.created++;
      for (const id of ids) this.stacked.add(id);
    }
  }
}

/** Hard-criteria bursts of two or more photos, each in stack order. */
async function hardGroups(userId: number, rules: Rule[], lrj: string | null): Promise<BurstCandidate[][]> {
  const photos = await rows<BurstCandidate>(sql`${BURST_SELECT}${ownedBy("p", userId)} ORDER BY p.id`);
  const total = photos.length;
  if (!total) return [];
  await progress(lrj, "burst_sequences", 0, total, 0);
  const tags = [...new Set(rules.flatMap(requiredExifTags))];
  const paths = photos.flatMap((p) => (p.main_file_path === null ? [] : [p.main_file_path]));
  const values = await readTags(config.exiftool ?? "exiftool", paths, tags, Math.max(1, Math.floor(os.cpus().length / 2)));
  const groups = new Map<string, BurstCandidate[]>();
  for (const p of photos) {
    if (p.main_file_path === null) continue;
    const v = values.get(p.main_file_path);
    const exif: ExifTags = new Map(v ? tags.map((t, i) => [t, v[i]]) : []);
    for (const rule of rules) {
      const [hit, key] = isBurstPhoto(rule, p, exif);
      if (hit && key !== null) {
        const g = groups.get(key);
        if (g) g.push(p);
        else groups.set(key, [p]);
        break;
      }
    }
  }
  await progress(lrj, "burst_sequences", total, total, groups.size);
  return [...groups.values()]
    .filter((m) => m.length >= 2)
    .map((m) => m.map((p, i) => [p, i] as const).sort((a, b) => (a[0].ts_us ?? a[0].added_us) - (b[0].ts_us ?? b[0].added_us) || a[1] - b[1]).map(([p]) => p));
}

function numberParam(rule: Rule, key: string, def: number): number {
  const v = rule.params[key];
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return def;
}

async function softCriteria(tx: Tx, userId: number, rules: Rule[], stacker: Stacker) {
  const photos = await rows<BurstCandidate>(sql`${BURST_SELECT}p.exif_timestamp IS NOT NULL AND ${ownedBy("p", userId)} ORDER BY p.exif_timestamp, p.id`, tx);
  if (photos.length < 2) return;
  for (const rule of rules) {
    let groups: number[][];
    if (rule.rule_type === "timestamp_proximity")
      groups = groupByTimestamp(photos, numberParam(rule, "interval_ms", 2000), optionFlag(rule.params, "require_same_camera", true));
    else if (rule.rule_type === "visual_similarity") groups = groupByVisual(photos, Math.floor(numberParam(rule, "similarity_threshold", 15)));
    else continue;
    for (const g of groups) await stacker.create(g.map((i) => photos[i]));
  }
}

/**
 * batch_detect_stacks / detect_burst_sequences: existing burst stacks are
 * replaced; hard rules group by EXIF or file name, soft rules by timestamp
 * proximity or visual similarity. All writes in one transaction.
 */
async function detectStacks(userId: number, options: Record<string, unknown>, lrj: string | null): Promise<number> {
  if (!optionFlag(options, "detect_bursts", true)) return 0;
  const user = await requireUser(userId);
  let rules: Rule[];
  try {
    rules = parseRules(user.rules);
  } catch (e) {
    // Django clears the old bursts before it reads the rules.
    await db.transaction((tx) => clearType(tx, userId, BURST));
    throw new Error(`invalid burst_detection_rules: ${e instanceof Error ? e.message : e}`);
  }
  const hard = rules.filter(isHard);
  const soft = rules.filter(isSoft);
  // The EXIF reads take minutes on a big library: do them before the
  // transaction, so its locks on the user's burst stacks stay short.
  const hardBursts = hard.length ? await hardGroups(userId, hard, lrj) : [];
  return db.transaction(async (tx) => {
    await clearType(tx, userId, BURST);
    const stacker = new Stacker(tx, userId);
    for (const members of hardBursts) await stacker.create(members);
    if (soft.length) await softCriteria(tx, userId, soft, stacker);
    return stacker.created;
  });
}

// ----------------------------------------------------------- dupes.detect

const reviewable = (userId: number) => sql`NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND ${ownedBy("p", userId)}`;

/** Photos sharing an image_hash (one list per hash with 2+ photos). */
const sameImageHashGroups = async (tx: Tx, userId: number) =>
  (
    await rows<{ ids: string[] }>(
      sql`SELECT json_agg(p.id ORDER BY p.id) AS ids FROM api_photo p WHERE ${reviewable(userId)}
        GROUP BY p.image_hash HAVING count(*) > 1 ORDER BY p.image_hash`,
      tx,
    )
  ).map((r) => r.ids);

/**
 * Photos whose non-metadata files share an MD5 (the first 32 hash
 * characters). As in Django, the photos of a group are those with any file
 * of that MD5 and no metadata file at all.
 */
const sameContentGroups = async (tx: Tx, userId: number) =>
  (
    await rows<{ ids: string[] }>(
      sql`WITH g AS (SELECT substring(f.hash, 1, 32) AS ch FROM api_file f
          JOIN api_photo_files pf ON pf.file_id = f.hash JOIN api_photo p ON p.id = pf.photo_id
          WHERE f.type <> 3 AND ${reviewable(userId)} GROUP BY 1 HAVING count(DISTINCT p.id) > 1)
        SELECT json_agg(DISTINCT p.id) AS ids FROM g
        JOIN api_photo_files pf ON substring(pf.file_id, 1, 32) = g.ch
        JOIN api_photo p ON p.id = pf.photo_id
        WHERE NOT EXISTS (SELECT 1 FROM api_photo_files mx JOIN api_file mfx ON mfx.hash = mx.file_id
          WHERE mx.photo_id = p.id AND mfx.type = 3) AND ${reviewable(userId)}
        GROUP BY g.ch ORDER BY g.ch`,
      tx,
    )
  ).map((r) => r.ids);

/** batch_detect_duplicates: exact copies, then visual pHash neighbours. One transaction. */
async function detectDuplicates(userId: number, options: Record<string, unknown>, lrj: string | null): Promise<number> {
  await requireUser(userId);
  const detectExact = optionFlag(options, "detect_exact_copies", true);
  const detectVisual = optionFlag(options, "detect_visual_duplicates", true);
  const threshold = ("visual_threshold" in options ? jsonInt(options.visual_threshold) : undefined) ?? 10;
  const laps: string[] = [];
  let last = performance.now();
  const lap = (stage: string) => {
    const now = performance.now();
    laps.push(`${stage}=${Math.round(now - last)}ms`);
    last = now;
  };
  const found = await db.transaction(async (tx) => {
    if (optionFlag(options, "clear_pending", false)) await clearPending(tx, userId);
    let found = 0;
    if (detectExact) {
      const byHash = await sameImageHashGroups(tx, userId);
      const byContent = await sameContentGroups(tx, userId);
      lap("exact_inputs");
      const total = byHash.length + byContent.length;
      await progress(lrj, "exact_copies", 0, total, 0);
      const uf = new UnionFind();
      for (const g of [...byHash, ...byContent]) for (const other of g.slice(1)) uf.union(g[0], other);
      found += await createOrMergeMany(tx, userId, EXACT_COPY, uf.groups());
      lap("exact_writes");
      await progress(lrj, "exact_copies", total, total, found);
    }
    if (detectVisual) {
      const candidates = await rows<{ id: string; h: string }>(
        sql`SELECT p.id, p.perceptual_hash AS h FROM api_photo p WHERE p.perceptual_hash IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM api_photo_duplicates x JOIN api_duplicate d ON d.id = x.duplicate_id
            WHERE x.photo_id = p.id AND d.duplicate_type = 'visual_duplicate') AND ${reviewable(userId)} ORDER BY p.id`,
        tx,
      );
      lap("visual_inputs");
      const total = candidates.length;
      if (total >= 2) {
        await progress(lrj, "visual_duplicates", 0, total, 0);
        const uf = new UnionFind();
        let pairs = 0;
        forEachVisualPair(
          candidates.map((c) => c.h),
          threshold,
          (a, b) => {
            pairs++;
            uf.union(candidates[a].id, candidates[b].id);
          },
        );
        const groups = uf.groups();
        lap("visual_pairs");
        console.log(`dupes.detect: user ${userId}: ${total} candidates, ${pairs} pairs, ${groups.length} groups`);
        found += await createOrMergeMany(tx, userId, VISUAL_DUPLICATE, groups);
        lap("visual_writes");
        await progress(lrj, "visual_duplicates", total, total, pairs);
      }
    }
    return found;
  });
  lap("commit");
  console.log(`dupes.detect: user ${userId}: found ${found} (${laps.join(" ")})`);
  return found;
}

registerJob(STACKS_DETECT, (ctx) =>
  run(ctx, async (userId, options, lrj) => ({ status: "completed", stacks_found: await detectStacks(userId, options, lrj) })),
);
registerJob(DUPES_DETECT, (ctx) =>
  run(ctx, async (userId, options, lrj) => ({ status: "completed", duplicates_found: await detectDuplicates(userId, options, lrj) })),
);
