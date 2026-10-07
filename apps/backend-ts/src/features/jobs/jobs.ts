// LongRunningJobViewSet (list, retrieve, destroy, cancel) and
// QueueAvailabilityView (`/api/rqavailable/`, polled every 2 s). Port of
// lp_api::jobs_zip_services::jobs and the reads in lp_db::jobs_zip_services.
import { sql, type SQL } from "drizzle-orm";
import { client, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { JOB_LABELS, lrjCancelWithQueue } from "~/lib/jobs";
import { drfPage, offset, pageRequest, validFor } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";

/** LongRunningJob.STUCK_JOB_HOURS */
const STUCK_JOB_HOURS = 24;

interface JobRow {
  id: number;
  job_type: number;
  finished: boolean;
  failed: boolean;
  cancelled: boolean;
  job_id: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress_current: number;
  progress_target: number;
  progress_step: string | null;
  result: unknown;
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
}

const JOB_SELECT = sql`SELECT j.id, j.job_type, j.finished, j.failed, j.cancelled, j.job_id,
    ${drfTs("j.queued_at")} AS queued_at, ${drfTs("j.started_at")} AS started_at, ${drfTs("j.finished_at")} AS finished_at,
    j.progress_current, j.progress_target, j.progress_step, j.result,
    u.id AS user_id, u.username, u.first_name, u.last_name
  FROM api_longrunningjob j JOIN api_user u ON u.id = j.started_by_id`;

/** LongRunningJobSerializer, in its field order. */
export function jobDto(r: JobRow) {
  return {
    job_id: r.job_id,
    queued_at: r.queued_at,
    finished: r.finished,
    finished_at: r.finished_at,
    started_at: r.started_at,
    failed: r.failed,
    cancelled: r.cancelled,
    job_type_str: JOB_LABELS[r.job_type] ?? "",
    job_type: r.job_type,
    started_by: { id: r.user_id, username: r.username, first_name: r.first_name, last_name: r.last_name },
    progress_current: r.progress_current,
    progress_target: r.progress_target,
    progress_step: r.progress_step,
    result: typeof r.result === "string" ? JSON.parse(r.result) : (r.result ?? null),
    id: r.id,
  };
}

const isStaff = (u: User) => u.isStaff || u.isSuperuser;

/**
 * get_queryset: non-staff see only their own jobs; staff see everything
 * unless they narrow with ?mine=true. null = every job.
 */
function scope(user: User, q: QueryMap): number | null {
  if (!isStaff(user)) return user.id;
  return q.get("mine")?.toLowerCase() === "true" ? user.id : null;
}

const ownerCond = (owner: number | null): SQL => (owner === null ? sql`TRUE` : sql`j.started_by_id = ${owner}`);

/** TinyResultsSetPagination: page size 20, page_size up to 50. Newest started_at first (NULLs first, as Postgres sorts -started_at). */
export async function listJobs(request: Request, user: User, q: QueryMap) {
  const owner = scope(user, q);
  const req0 = pageRequest(q, "page_size", 20, 50);
  const c = await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_longrunningjob j WHERE ${ownerCond(owner)}`);
  const count = c?.n ?? 0;
  const req = validFor(req0, count);
  const rs = await rows<JobRow>(
    sql`${JOB_SELECT} WHERE ${ownerCond(owner)} ORDER BY j.started_at DESC, j.id LIMIT ${req.pageSize} OFFSET ${offset(req)}`,
  );
  return drfPage(request, req, count, rs.map(jobDto));
}

function parsePk(id: string): number {
  if (!/^\d+$/.test(id) || Number(id) > 2147483647) throw ApiError.notFound();
  return Number(id);
}

const noMatch = () => ApiError.notFound("No LongRunningJob matches the given query.");

async function jobByPk(pk: number, owner: number | null): Promise<JobRow | undefined> {
  return row<JobRow>(sql`${JOB_SELECT} WHERE j.id = ${pk} AND ${ownerCond(owner)}`);
}

async function scopedJob(user: User, q: QueryMap, id: string): Promise<JobRow> {
  const job = await jobByPk(parsePk(id), scope(user, q));
  if (!job) throw noMatch();
  return job;
}

export async function jobDetail(user: User, q: QueryMap, id: string) {
  return jobDto(await scopedJob(user, q, id));
}

/** DELETE /api/jobs/{id}/: the row goes; queue rows still waiting for it are cancelled. */
export async function destroyJob(user: User, q: QueryMap, id: string): Promise<Response> {
  const pk = parsePk(id);
  const owner = scope(user, q);
  const deleted = await client.begin(async (tx) => {
    const r = await tx`DELETE FROM api_longrunningjob WHERE id = ${pk} AND (${owner}::int IS NULL OR started_by_id = ${owner}::int) RETURNING job_id`;
    if (!r.length) return false;
    await tx`UPDATE job_queue SET status = 'cancelled', finished_at = now(), locked_by = NULL WHERE lrj_id = ${r[0].job_id} AND status = 'queued'`;
    return true;
  });
  if (!deleted) throw noMatch();
  return new Response(null, { status: 204 });
}

/** POST /api/jobs/{id}/cancel/: cooperative; the queue rows are cancelled too. */
export async function cancelJob(user: User, q: QueryMap, id: string) {
  const job = await scopedJob(user, q, id);
  if (job.finished) return json({ status: false, message: "Job is already finished" }, 400);
  await lrjCancelWithQueue(job.job_id);
  const fresh = await jobByPk(job.id, null);
  if (!fresh) throw ApiError.notFound();
  return { status: true, job: jobDto(fresh) };
}

/**
 * The unfinished job that blocks the queue, ignoring rows older than the
 * stuck-job horizon (Django: .order_by("-started_at").last(), i.e. started_at
 * ASC with NULLs last). Whether the queue is busy is a global answer; the
 * job itself is shown only to its starter and to staff (GHSA-975v-mx44-9jxq).
 * One indexed query.
 */
export async function rqAvailable(user: User) {
  const running = await row<JobRow>(sql`${JOB_SELECT}
    WHERE NOT j.finished AND (j.started_at >= now() - make_interval(hours => ${STUCK_JOB_HOURS})
      OR (j.started_at IS NULL AND j.queued_at >= now() - make_interval(hours => ${STUCK_JOB_HOURS})))
    ORDER BY j.started_at ASC, j.id ASC LIMIT 1`);
  const visible = running && (running.user_id === user.id || isStaff(user));
  return { status: true, queue_can_accept_job: !running, job_detail: visible ? jobDto(running) : null };
}
