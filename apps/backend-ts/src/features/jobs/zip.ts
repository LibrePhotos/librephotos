// Zip downloads (api/views/zip_downloads.py, api/all_tasks.py; port of
// lp_api::jobs_zip_services::zip): POST /api/photos/download starts a
// zip.build job, GET ?job_id= polls it, DELETE /api/delete/zip/{uuid}
// removes the archive. The job streams the archive to
// protected_media/zip/<uuid><user id>.zip.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { config } from "~/lib/config";
import { pgArray, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { enqueue, JobType, lrjFinish, lrjStart, registerJob, type JobCtx } from "~/lib/jobs";
import { pyTruthy, type QueryMap } from "~/lib/query";
import { ownedBy, photoFilters, photoFiltersFromJson } from "~/lib/scope";
import type { User } from "~/lib/users";
import { ZipWriter } from "./zipWriter";

export const zipDir = () => path.join(config.mediaRoot, "zip");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * zip_file_name: <uuid><user id>.zip, only for a canonical UUID (so a
 * crafted value can neither leave the zip directory nor name another user's archive).
 */
export function zipFileName(fileUuid: string, userId: number): string | null {
  return UUID_RE.test(fileUuid) ? `${fileUuid.toLowerCase()}${userId}.zip` : null;
}

/** include_stacked_photos: list -> first item, string -> "1/true/yes/on", else truthiness. */
function includeStacked(v: unknown): boolean {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  return pyTruthy(v);
}

function stringList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return [];
}

/** Free bytes on the filesystem holding p (or its nearest existing ancestor). */
async function freeSpace(p: string): Promise<number | null> {
  let probe = p;
  while (!existsSync(probe)) {
    const up = path.dirname(probe);
    if (up === probe) return null;
    probe = up;
  }
  try {
    const s = await statfs(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

interface ZipPayload {
  user_id: number;
  photo_ids: string[];
  zip_uuid: string;
  include_stacked_photos: boolean;
}

/** The photos to archive, owner-scoped, optionally widened to every owned photo sharing a stack with one of them. One query. */
async function downloadPhotos(userId: number, selection: SQL, stacked: boolean) {
  const tail = stacked
    ? sql`, stk AS (SELECT DISTINCT ps.photostack_id FROM api_photo_stacks ps JOIN sel ON sel.id = ps.photo_id),
          allp AS (SELECT id FROM sel UNION SELECT ps.photo_id FROM api_photo_stacks ps JOIN stk USING (photostack_id))
        SELECT p.id, p.size::float8 AS size FROM api_photo p JOIN allp ON allp.id = p.id WHERE ${ownedBy("p", userId)}`
    : sql` SELECT p.id, p.size::float8 AS size FROM api_photo p JOIN sel ON sel.id = p.id`;
  return rows<{ id: string; size: number }>(sql`WITH sel AS (SELECT p.id FROM api_photo p WHERE ${selection})${tail}`);
}

/** POST /api/photos/download: {image_hashes} or {select_all, query, excluded_hashes}, plus include_stacked_photos -> {job_id, url}. */
export async function startDownload(user: User, request: Request) {
  const data = await jsonBody(request);
  const stacked = includeStacked(data.include_stacked_photos);
  let selection: SQL;
  if (pyTruthy(data.select_all)) {
    let query = Array.isArray(data.query) ? (data.query[0] ?? null) : (data.query ?? null);
    if (!query || typeof query !== "object" || Array.isArray(query)) query = {};
    const params = photoFiltersFromJson(query);
    const excluded = pyTruthy(data.excluded_hashes) ? stringList(data.excluded_hashes) : [];
    selection = photoFilters("p", user.id, user.favoriteMinRating, params);
    if (excluded.length) selection = sql`${selection} AND NOT (p.image_hash = ANY(${pgArray(excluded, "text")}))`;
  } else {
    if (!pyTruthy(data.image_hashes)) return json({ error: "image_hashes required" }, 400);
    const hashes = stringList(data.image_hashes);
    selection = sql`${ownedBy("p", user.id)} AND p.image_hash = ANY(${pgArray(hashes, "text")})`;
  }
  const photos = await downloadPhotos(user.id, selection, stacked);
  if (!photos.length) return json({ error: "No photos found" }, 404);

  const total = photos.reduce((s, p) => s + Math.max(0, Number(p.size) || 0), 0);
  const free = await freeSpace(zipDir());
  if (free !== null && free < total) return json({ status: "Insufficient Storage" }, 507);

  const fileUuid = randomUUID();
  const payload: ZipPayload = {
    user_id: user.id,
    photo_ids: photos.map((p) => p.id),
    zip_uuid: fileUuid,
    include_stacked_photos: stacked,
  };
  const { lrjId } = await enqueue("zip.build", payload, { lrj: { jobType: JobType.DownloadPhotos, userId: user.id } });
  return { job_id: lrjId, url: fileUuid };
}

/**
 * GET /api/photos/download?job_id=: 200 SUCCESS / 500 FAILURE / 202
 * PENDING. Like Django, finished is checked first (a failed job is also
 * finished); only the starter may poll.
 */
export async function pollDownload(user: User, q: QueryMap) {
  const jobId = q.nonEmpty("job_id");
  if (jobId === undefined) return json({ error: "job_id is required" }, 400);
  const job = await row<{ finished: boolean; failed: boolean; result: unknown }>(
    sql`SELECT finished, failed, result FROM api_longrunningjob WHERE job_id = ${jobId} AND started_by_id = ${user.id} LIMIT 1`,
  );
  if (!job) throw ApiError.statusOnly(404);
  if (job.finished) return { status: "SUCCESS" };
  if (job.failed) return json({ status: "FAILURE", result: job.result ?? null }, 500);
  return json({ status: "PENDING", progress: job.result ?? null }, 202);
}

/** DELETE /api/delete/zip/{uuid}: the archive is named after the requester, so only their own can be named. A missing file is still 200. */
export async function deleteZip(user: User, fname: string) {
  if (!UUID_RE.test(fname)) throw ApiError.notFound();
  const name = zipFileName(fname, user.id);
  if (!name) throw ApiError.statusOnly(404);
  const p = path.join(zipDir(), name);
  try {
    await unlink(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") console.warn(`zip to delete not found: ${p}`);
    else console.error(`deleting zip ${p} failed`, e);
  }
  return new Response(null, { status: 200 });
}

/** os.path.splitext: the last dot not leading the name starts the extension. */
function splitext(name: string): [string, string] {
  const lead = name.length - name.replace(/^\.+/, "").length;
  const i = name.slice(lead).lastIndexOf(".");
  return i < 0 ? [name, ""] : [name.slice(0, lead + i), name.slice(lead + i)];
}

/** _unique_arcname */
function uniqueArcname(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const [base, ext] = splitext(name);
  for (let n = 1; ; n++) {
    const c = `${base}_${n}${ext}`;
    if (!taken.has(c)) return c;
  }
}

/**
 * Every file of the given photos in _add_photo_files_to_zip order: main
 * file, the photo's files, files of legacy RAW+JPEG / live-photo stack mates,
 * then the embedded media of all of those. Owner-scoped.
 */
async function zipFiles(userId: number, photoIds: string[]) {
  return rows<{ ord: number; path: string }>(sql`WITH ph AS (
      SELECT p.id, t.ord::int AS ord FROM unnest(${pgArray(photoIds, "uuid")}) WITH ORDINALITY AS t(value, ord)
      JOIN api_photo p ON p.id = t.value AND ${ownedBy("p", userId)}),
    mates AS (
      SELECT DISTINCT ph.ord, ps2.photo_id AS id FROM ph
      JOIN api_photo_stacks ps ON ps.photo_id = ph.id
      JOIN api_photostack st ON st.id = ps.photostack_id AND st.stack_type IN ('raw_jpeg', 'live_photo')
      JOIN api_photo_stacks ps2 ON ps2.photostack_id = st.id),
    own AS (
      SELECT ph.ord, 0 AS g, 0 AS s, f.hash, f.path FROM ph
        JOIN api_photo p ON p.id = ph.id JOIN api_file f ON f.hash = p.main_file_id
      UNION ALL
      SELECT ph.ord, 1, pf.id, f.hash, f.path FROM ph
        JOIN api_photo_files pf ON pf.photo_id = ph.id JOIN api_file f ON f.hash = pf.file_id
      UNION ALL
      SELECT m.ord, 2, 0, f.hash, f.path FROM mates m
        JOIN api_photo p ON p.id = m.id JOIN api_file f ON f.hash = p.main_file_id
      UNION ALL
      SELECT m.ord, 3, pf.id, f.hash, f.path FROM mates m
        JOIN api_photo_files pf ON pf.photo_id = m.id JOIN api_file f ON f.hash = pf.file_id),
    emb AS (
      SELECT own.ord, 4 AS g, em.id AS s, f.hash, f.path FROM own
        JOIN api_file_embedded_media em ON em.from_file_id = own.hash
        JOIN api_file f ON f.hash = em.to_file_id)
    SELECT ord, path FROM (SELECT * FROM own UNION ALL SELECT * FROM emb) x ORDER BY ord, g, s`);
}

/** How often (in photos) the job checks for cancellation. */
const CANCEL_CHECK_EVERY = 100;

/** Writes every photo's files; false when the job was cancelled. */
async function writeArchive(ctx: JobCtx, p: ZipPayload, part: string): Promise<boolean> {
  const byPhoto: string[][] = p.photo_ids.map(() => []);
  for (const r of await zipFiles(p.user_id, p.photo_ids)) byPhoto[r.ord - 1]?.push(r.path);
  const zip = await ZipWriter.create(part);
  const paths = new Set<string>();
  const names = new Set<string>();
  try {
    for (const [i, files] of byPhoto.entries()) {
      if (i > 0 && i % CANCEL_CHECK_EVERY === 0 && (await ctx.isCancelled())) {
        await zip.abort();
        return false;
      }
      for (const f of files) {
        if (!f || paths.has(f)) continue;
        const st = await stat(f).catch(() => null);
        if (!st?.isFile()) {
          console.warn(`zip: file not found, skipping: ${f}`);
          continue;
        }
        const name = uniqueArcname(path.basename(f) || f, names);
        await zip.addFile(name, f, st.size, st.mtime);
        paths.add(f);
        names.add(name);
      }
      await ctx.progress.inc(1);
    }
    await ctx.progress.flush();
    await zip.finish();
    return true;
  } catch (e) {
    await zip.abort();
    throw e;
  }
}

/**
 * zip.build: zip_photos_task. Progress is the photo count; the file is
 * written as .part and renamed when complete, so a download never sees half
 * an archive.
 */
registerJob("zip.build", async (ctx) => {
  const p = ctx.payload as ZipPayload;
  const lrjId = ctx.lrjId;
  if (!lrjId) throw new Error("zip.build needs a LongRunningJob");
  await lrjStart(lrjId, p.photo_ids.length);
  const name = zipFileName(p.zip_uuid, p.user_id);
  if (!name) throw new Error("bad zip uuid");
  const dir = zipDir();
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, name);
  const part = path.join(dir, `${name}.part`);
  try {
    if (await writeArchive(ctx, p, part)) {
      await rename(part, finalPath);
      await lrjFinish(lrjId);
    } else {
      await rm(part, { force: true });
    }
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
});
