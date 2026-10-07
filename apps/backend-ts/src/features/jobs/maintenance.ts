// Code-defined recurring jobs and their handlers (port of lp_jobs::schedules,
// lp_jobs::maintenance and the writes in lp_db::write::jobs_zip_services).
// schedule_state records when each one is next due, so restarts and several
// workers never double-run one. The worker's 30 s maintenance tick (and its
// start) enqueues whatever is due.
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "~/lib/config";
import { client } from "~/lib/db";
import { enqueueIn, registerJob, registerMaintenance, registeredKinds, wakeWorker } from "~/lib/jobs";
import { deleteFilesAfterCommit, hardDeletePhotos } from "./photoDelete";
import { zipDir } from "./zip";

type Exec = typeof client;

/** Removed photos stay in the trash this long before they are deleted. */
const DELETED_PHOTO_DAYS = 30;
/** LongRunningJob.STUCK_JOB_HOURS */
const STUCK_JOB_HOURS = 24;
/** cleanup_old_jobs(days=30) */
const OLD_JOB_DAYS = 30;
/** A zip archive is deleted this long after it was written. */
const ZIP_TTL_MS = 24 * 3600 * 1000;
/** DeletionLog.PRUNE_HORIZON_DAYS */
const PRUNE_HORIZON_DAYS = 90;

const HOUR = 3600;
const DAY = 24 * HOUR;

interface Schedule {
  /** schedule_state.name */
  name: string;
  /** Job kind enqueued when due (payload {}). */
  kind: string;
  everySecs: number;
}

const SCHEDULES: Schedule[] = [
  { name: "cleanup_deleted_photos", kind: "maintenance.cleanup_deleted_photos", everySecs: DAY },
  { name: "cleanup_stuck_jobs", kind: "maintenance.cleanup_stuck_jobs", everySecs: HOUR },
  { name: "cleanup_old_jobs", kind: "maintenance.cleanup_old_jobs", everySecs: DAY },
  { name: "zip_expiry", kind: "maintenance.zip_expiry", everySecs: HOUR },
  { name: "prune_refresh_tokens", kind: "maintenance.prune_refresh_tokens", everySecs: DAY },
  // start_cleaning_service: mobile-sync tombstones past the 90-day horizon.
  { name: "prune_deletion_log", kind: "maintenance.prune_deletion_log", everySecs: DAY },
];

/**
 * Enqueue every schedule that is due, claiming it in schedule_state in the
 * same transaction. A schedule without a row is due at once. One read for all
 * schedules; a transaction only for the due ones.
 */
export async function runDueSchedules(): Promise<string[]> {
  const kinds = new Set(registeredKinds());
  const active = SCHEDULES.filter((s) => kinds.has(s.kind));
  const notDue: { name: string }[] = await client`SELECT name FROM schedule_state WHERE next_run_at > now()`;
  const skip = new Set(notDue.map((r) => r.name));
  const fired: string[] = [];
  for (const s of active.filter((x) => !skip.has(x.name))) {
    const won = await client.begin(async (tx) => {
      const r = await tx`INSERT INTO schedule_state (name, last_run_at, next_run_at)
          VALUES (${s.name}, now(), now() + make_interval(secs => ${s.everySecs}))
        ON CONFLICT (name) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, next_run_at = EXCLUDED.next_run_at
          WHERE schedule_state.next_run_at IS NULL OR schedule_state.next_run_at <= now()
        RETURNING name`;
      if (!r.length) return false;
      await enqueueIn(tx as unknown as Exec, s.kind, {});
      return true;
    });
    if (won) fired.push(s.name);
  }
  if (fired.length) {
    console.log(`scheduled jobs enqueued: ${fired.join(", ")}`);
    wakeWorker();
  }
  return fired;
}

/** api.services.cleanup_deleted_photos: photos removed for more than `days` days are deleted for good. */
async function cleanupDeletedPhotos(days: number): Promise<number> {
  let files: string[] = [];
  const n = await client.begin(async (tx) => {
    const ids: { id: string }[] = await tx`SELECT id FROM api_photo WHERE removed AND last_modified <= now() - make_interval(days => ${days})`;
    files = await hardDeletePhotos(tx as unknown as Exec, ids.map((r) => r.id), config.mediaRoot);
    return ids.length;
  });
  await deleteFilesAfterCommit(files);
  return n;
}

/**
 * LongRunningJob.cleanup_stuck_jobs: unfinished jobs older than `hours` (by
 * started_at, or queued_at if never started) are failed; their queue rows
 * that never started are cancelled.
 */
async function cleanupStuckJobs(hours: number): Promise<number> {
  const result = JSON.stringify({ status: "failed", error: `Job timed out after ${hours} hours` });
  return client.begin(async (tx) => {
    const ids: { job_id: string }[] = await tx`UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(),
        result = ${result}::text::jsonb
      WHERE NOT finished AND (
        (started_at IS NOT NULL AND started_at < now() - make_interval(hours => ${hours}))
        OR (started_at IS NULL AND queued_at < now() - make_interval(hours => ${hours})))
      RETURNING job_id`;
    if (ids.length) {
      await tx.unsafe("UPDATE job_queue SET status = 'cancelled', finished_at = now() WHERE lrj_id = ANY($1::text[]) AND status = 'queued'", [
        `{${ids.map((r) => `"${r.job_id}"`).join(",")}}`,
      ]);
    }
    return ids.length;
  });
}

/**
 * LongRunningJob.cleanup_old_jobs: finished jobs older than `days` go,
 * except the latest finished one per (user, job type), which is the
 * incremental-scan baseline. Finished job_queue rows of that age go too.
 */
async function cleanupOldJobs(days: number): Promise<number> {
  const r = await client`DELETE FROM api_longrunningjob WHERE finished AND finished_at < now() - make_interval(days => ${days})
      AND id NOT IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (
            PARTITION BY started_by_id, job_type ORDER BY finished_at DESC, id DESC) AS rn
          FROM api_longrunningjob WHERE finished AND finished_at IS NOT NULL) latest
        WHERE rn = 1)
    RETURNING 1`;
  await client`DELETE FROM job_queue WHERE status IN ('done', 'failed', 'cancelled')
      AND COALESCE(finished_at, created_at) < now() - make_interval(days => ${days})`;
  return r.length;
}

/** Delete *.zip (and abandoned *.part) files older than the TTL. */
async function expireZips(dir: string, ttlMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
  const now = Date.now();
  let n = 0;
  for (const name of entries) {
    const ext = path.extname(name);
    if (ext !== ".zip" && ext !== ".part") continue;
    const p = path.join(dir, name);
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) continue;
    if (now - st.mtimeMs >= ttlMs) {
      try {
        await unlink(p);
        n++;
      } catch (e) {
        console.warn(`zip expiry: ${p}`, e);
      }
    }
  }
  return n;
}

registerJob("maintenance.cleanup_deleted_photos", async () => {
  console.log(`cleanup_deleted_photos: deleted ${await cleanupDeletedPhotos(DELETED_PHOTO_DAYS)}`);
});
registerJob("maintenance.cleanup_stuck_jobs", async () => {
  const n = await cleanupStuckJobs(STUCK_JOB_HOURS);
  if (n) console.log(`cleanup_stuck_jobs: failed ${n}`);
});
registerJob("maintenance.cleanup_old_jobs", async () => {
  console.log(`cleanup_old_jobs: deleted ${await cleanupOldJobs(OLD_JOB_DAYS)}`);
});
// Expired rows of the refresh-token store.
registerJob("maintenance.prune_refresh_tokens", async () => {
  await client`DELETE FROM refresh_token WHERE expires_at < now()`;
});
registerJob("maintenance.prune_deletion_log", async () => {
  const r = await client`DELETE FROM api_deletionlog WHERE deleted_at < now() - make_interval(days => ${PRUNE_HORIZON_DAYS}) RETURNING 1`;
  console.log(`prune_deletion_log: deleted ${r.length}`);
});
registerJob("maintenance.zip_expiry", async () => {
  const n = await expireZips(zipDir(), ZIP_TTL_MS);
  if (n) console.log(`zip_expiry: deleted ${n}`);
});

registerMaintenance(async () => {
  await runDueSchedules();
});
