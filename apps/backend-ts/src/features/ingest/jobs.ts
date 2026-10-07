// Job handlers owned by ingest (port of lp-ingest jobs.rs); payloads carry
// ids only and match librephotos-rs, so both servers can share a queue:
// scan.user, scan.file_group, thumbnails.rerender, metadata.write,
// metadata.face_tags, delete.missing_photos, repair.file_variants,
// upload.process.
import { client } from "../../lib/db";
import { exif } from "../../lib/exif";
import { JobType, registerJob, type JobCtx } from "../../lib/jobs";
import * as dates from "./dates";
import * as db from "./db";
import { KIND as FACE_TAGS_KIND, runFaceTags } from "./faceTags";
import { handleFileGroup, loadOwner, regenerateThumbnails } from "./pipeline";
import { deleteMissingPhotos, repairFileVariants } from "./repair";
import { queueFollowups, scanUser } from "./scan";
import { createNewImage, processUpload } from "./upload";

const lrjId = (ctx: JobCtx) => ctx.lrjId ?? crypto.randomUUID();

function need<T>(ctx: JobCtx, key: string, check: (v: unknown) => boolean): T {
  const v = ctx.payload?.[key];
  if (!check(v)) throw new Error(`bad ${ctx.job.kind} payload: ${key}`);
  return v as T;
}
const isInt = (v: unknown) => Number.isInteger(v);
const isStr = (v: unknown) => typeof v === "string";

export async function scanUserJob(ctx: JobCtx) {
  const p = ctx.payload ?? {};
  await scanUser(need<number>(ctx, "user_id", isInt), lrjId(ctx), {
    fullScan: !!p.full_scan,
    scanMissing: !!p.scan_missing,
    uploadedOnly: !!p.uploaded_only,
    files: Array.isArray(p.files) ? p.files : [],
  });
}

/** One group outside a whole-library scan: progress on the job it belongs to, which finishes (and queues its follow-ups) with its last group. */
export async function scanFileGroupJob(ctx: JobCtx) {
  const userId = need<number>(ctx, "user_id", isInt);
  const paths = need<string[]>(ctx, "paths", Array.isArray);
  const owner = await loadOwner(userId);
  if (!owner) throw new Error(`user ${userId} not found`);
  const outcome = await handleFileGroup(owner, paths);
  const job = ctx.lrjId;
  if (!job) {
    if (!outcome.ok) throw new Error(outcome.error);
    return;
  }
  await client`UPDATE api_longrunningjob SET progress_current = progress_current + 1 WHERE job_id = ${job}`;
  if (!outcome.ok) {
    const [lrj] = await client`SELECT result, progress_target FROM api_longrunningjob WHERE job_id = ${job}`;
    const result: Record<string, unknown> = lrj?.result && typeof lrj.result === "object" && !Array.isArray(lrj.result) ? { ...lrj.result } : {};
    const count = (Number(result.error_count) || 0) + 1;
    result.error_count = count;
    const errors = Array.isArray(result.errors) ? [...result.errors] : [];
    if (!errors.includes(outcome.error)) errors.push(outcome.error);
    result.errors = errors;
    if (!("error" in result)) result.error = outcome.error;
    const target = Math.max(0, lrj?.progress_target ?? 0);
    const failed = target === 0 ? true : count > Math.max(10, 0.05 * target);
    result.status = failed ? "failed" : "partial_failure";
    await db.lrjRecordErrors(job, result, failed);
  }
  const finished = await client`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = ${job}
    AND NOT finished AND NOT cancelled AND progress_current >= progress_target RETURNING 1`;
  const [lrj] = await client`SELECT job_type, result FROM api_longrunningjob WHERE job_id = ${job}`;
  if (!lrj || !finished.length || lrj.job_type !== JobType.ScanPhotos) return;
  // queue_scan_followups: the options the scan stored, taken once.
  const opts = lrj.result && typeof lrj.result === "object" ? lrj.result.followups : null;
  await client`UPDATE api_longrunningjob SET result = result - 'followups' WHERE job_id = ${job} AND jsonb_typeof(result) = 'object'`;
  if (opts && typeof opts === "object" && Object.keys(opts).length) {
    await queueFollowups(userId, opts.full_scan === true, opts.scan_missing_photos === true);
  }
}

export async function thumbnailsRerenderJob(ctx: JobCtx) {
  await regenerateThumbnails(need<string>(ctx, "photo_id", isStr));
}

/** write_photo_metadata for the listed fields, per the owner's save_metadata_to_disk. */
export async function metadataWriteJob(ctx: JobCtx) {
  const photoId = need<string>(ctx, "photo_id", isStr);
  const fields: string[] = Array.isArray(ctx.payload.fields) ? ctx.payload.fields : [];
  const [row] = await client`SELECT p.rating, to_char(p.timestamp AT TIME ZONE 'UTC', 'YYYY:MM:DD HH24:MI:SS') AS ts,
      u.save_metadata_to_disk AS mode, f.path FROM api_photo p JOIN api_user u ON u.id = p.owner_id
      LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = ${photoId}::uuid`;
  if (!row || !row.path || row.mode === "OFF") return;
  const tags: [string, unknown][] = [];
  if (fields.includes("rating")) tags.push(["Rating", row.rating]);
  if (fields.includes("timestamp")) tags.push(["XMP:DateCreated", row.ts ?? ""]);
  if (!tags.length) return;
  await exif.writeMetadata(row.path, tags, row.mode === "SIDECAR_FILE");
}

export async function deleteMissingPhotosJob(ctx: JobCtx) {
  await deleteMissingPhotos(need<number>(ctx, "user_id", isInt), lrjId(ctx));
}

export async function repairFileVariantsJob(ctx: JobCtx) {
  await repairFileVariants(need<number>(ctx, "user_id", isInt), lrjId(ctx));
}

/** An RFC 3339 instant (serde's DateTime<Utc>) as UTC microseconds. */
function parseRfc3339(s: string): dates.Micros | null {
  const m = /^(.+?[T ]\d\d:\d\d:\d\d(?:\.\d+)?)(Z|[+-]\d\d:?\d\d)?$/i.exec(s.trim());
  const local = m ? dates.fromPgText(m[1]) : null;
  if (local === null) return null;
  const off = m![2] && m![2].toUpperCase() !== "Z" ? m![2].replace(":", "") : null;
  if (!off) return local;
  const sign = off[0] === "-" ? -1 : 1;
  return local - sign * (Number(off.slice(1, 3)) * 3600 + Number(off.slice(3, 5)) * 60) * 1e6;
}

export async function uploadProcessJob(ctx: JobCtx) {
  const userId = need<number>(ctx, "user_id", isInt);
  const p = ctx.payload;
  let photo: string | null = typeof p.photo_id === "string" ? p.photo_id : null;
  if (!photo && typeof p.path === "string") photo = await createNewImage(userId, p.path);
  if (!photo) return;
  await processUpload(userId, photo, typeof p.device_created_at === "string" ? parseRfc3339(p.device_created_at) : null);
}

registerJob("scan.user", scanUserJob);
registerJob("scan.file_group", scanFileGroupJob);
registerJob("thumbnails.rerender", thumbnailsRerenderJob);
registerJob("metadata.write", metadataWriteJob);
registerJob(FACE_TAGS_KIND, runFaceTags);
registerJob("delete.missing_photos", deleteMissingPhotosJob);
registerJob("repair.file_variants", repairFileVariantsJob);
registerJob("upload.process", uploadProcessJob);
