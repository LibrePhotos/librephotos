// Background jobs (port of lp_jobs: queue, lrj, registry, worker). The same
// job_queue table librephotos-rs uses, and api_longrunningjob stays the UI
// contract (the jobs page and the worker indicator poll it every 2 s).
//
// Enqueue from a route:
//   const { lrjId } = await enqueue("scan.photos", { user_id: user.id }, { lrj: { jobType: JobType.ScanPhotos, userId: user.id } });
// Register a handler (src/jobs/index.ts imports every area's handlers):
//   registerJob("scan.photos", async (ctx) => { ... await ctx.progress.inc(1); ... });
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { arrayLiteral, client } from "./db";

/** LongRunningJob.JOB_* (same integers as Django; 19 is Rust/TS-only). */
export enum JobType {
  ScanPhotos = 1,
  GenerateAutoAlbums = 2,
  GenerateAutoAlbumTitles = 3,
  TrainFaces = 4,
  DeleteMissingPhotos = 5,
  CalculateClipEmbeddings = 6,
  ScanFaces = 7,
  ClusterAllFaces = 8,
  DownloadPhotos = 9,
  DownloadModels = 10,
  AddGeolocation = 11,
  GenerateTags = 12,
  GenerateFaceEmbeddings = 13,
  ScanMissingPhotos = 14,
  DetectDuplicates = 15,
  RepairFileVariants = 16,
  ClassifyMedia = 17,
  GenerateOcr = 18,
  DetectStacks = 19,
}

/** get_job_type_display() */
export const JOB_LABELS: Record<number, string> = {
  1: "Scan Photos",
  2: "Generate Event Albums",
  3: "Regenerate Event Titles",
  4: "Train Faces",
  5: "Delete Missing Photos",
  6: "Calculate Clip Embeddings",
  7: "Scan Faces",
  8: "Find Similar Faces",
  9: "Download Selected Photos",
  10: "Download Models",
  11: "Add Geolocation",
  12: "Generate Tags",
  13: "Generate Face Embeddings",
  14: "Scan Missing Photos",
  15: "Detect Duplicate Photos",
  16: "Repair File Variants",
  17: "Classify Media Categories",
  18: "Extract Text (OCR)",
  19: "Detect Photo Stacks",
};

type Exec = typeof client;

// ------------------------------------------------------------------ LRJ

/** LongRunningJob.create_job: a queued row; returns its job_id. */
export async function lrjCreate(jobType: JobType, userId: number, tx: Exec = client): Promise<string> {
  const jobId = randomUUID();
  await tx`INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, started_by_id, progress_current, progress_target)
           VALUES (${jobType}, FALSE, FALSE, FALSE, ${jobId}, now(), ${userId}, 0, 0)`;
  return jobId;
}

export async function lrjStart(jobId: string, target?: number, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET started_at = COALESCE(started_at, now()), progress_target = COALESCE(${target ?? null}::int, progress_target) WHERE job_id = ${jobId}`;
}
export async function lrjSetTarget(jobId: string, target: number, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET progress_target = ${Math.max(0, target)} WHERE job_id = ${jobId}`;
}
export async function lrjSetStep(jobId: string, step: string, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET progress_step = ${[...step].slice(0, 100).join("")} WHERE job_id = ${jobId}`;
}
export async function lrjSetResult(jobId: string, result: unknown, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET result = ${JSON.stringify(result)}::text::jsonb WHERE job_id = ${jobId}`;
}
export async function lrjAddProgress(jobId: string, delta: number, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET progress_current = progress_current + ${delta} WHERE job_id = ${jobId}`;
}
/** Finish exactly once (guarded UPDATE); true for the caller that won. */
export async function lrjFinish(jobId: string, result?: unknown, tx: Exec = client): Promise<boolean> {
  const r = await tx`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now(),
      result = COALESCE(${result === undefined ? null : JSON.stringify(result)}::text::jsonb, result)
    WHERE job_id = ${jobId} AND NOT finished RETURNING 1`;
  return r.length > 0;
}
/** LongRunningJob.fail: failed + finished, result = {status: failed, error}. */
export async function lrjFail(jobId: string, error: string, tx: Exec = client): Promise<boolean> {
  const r = await tx`UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(),
      result = ${JSON.stringify({ status: "failed", error })}::text::jsonb WHERE job_id = ${jobId} AND NOT finished RETURNING 1`;
  return r.length > 0;
}
/** LongRunningJob.cancel (cooperative: handlers poll ctx.isCancelled()). */
export async function lrjCancel(jobId: string, tx: Exec = client): Promise<boolean> {
  const r = await tx`UPDATE api_longrunningjob SET cancelled = TRUE, finished = TRUE, finished_at = now(),
      result = '{"status": "cancelled"}' WHERE job_id = ${jobId} AND NOT finished RETURNING 1`;
  return r.length > 0;
}
/** The cancel endpoint: the LongRunningJob and its queued/running job_queue rows. */
export async function lrjCancelWithQueue(jobId: string): Promise<boolean> {
  return client.begin(async (tx) => {
    const won = await lrjCancel(jobId, tx as unknown as Exec);
    await tx`UPDATE job_queue SET status = 'cancelled', finished_at = now(), locked_by = NULL WHERE lrj_id = ${jobId} AND status IN ('queued', 'running')`;
    return won;
  });
}
export async function lrjIsCancelled(jobId: string): Promise<boolean> {
  const r = await client`SELECT cancelled FROM api_longrunningjob WHERE job_id = ${jobId}`;
  return r[0]?.cancelled ?? false;
}

/** Progress counter with increments flushed at most every 250 ms. */
export class Progress {
  private pending = 0;
  private last = Date.now();
  constructor(private jobId: string | null) {}
  async inc(n = 1) {
    this.pending += n;
    if (Date.now() - this.last >= 250) await this.flush();
  }
  async flush() {
    if (this.pending && this.jobId) await lrjAddProgress(this.jobId, this.pending);
    this.pending = 0;
    this.last = Date.now();
  }
}

/** Per-item errors collected for result (deduped, at most 100 kept). */
export class JobErrors {
  count = 0;
  first: string | null = null;
  private kept: string[] = [];
  private seen = new Set<string>();
  add(msg: string) {
    this.count++;
    this.first ??= msg;
    if (this.kept.length < 100 && !this.seen.has(msg)) {
      this.seen.add(msg);
      this.kept.push(msg);
    }
  }
  /** failed only above max(10, 5% of total) errors, else partial_failure. */
  isFailure(total: number) {
    return this.count > Math.max(10, Math.floor(total / 20));
  }
  toResult(total: number) {
    if (!this.count) return null;
    return { status: this.isFailure(total) ? "failed" : "partial_failure", error_count: this.count, errors: this.kept, error: this.first };
  }
}

// ---------------------------------------------------------------- queue

export interface EnqueueOptions {
  runAfter?: Date;
  maxAttempts?: number;
  groupId?: string;
  /** Create a new tracked LongRunningJob of this type for the UI. */
  lrj?: { jobType: JobType; userId: number };
  /** Reuse an existing LongRunningJob (fan-out children of a scan). */
  lrjId?: string;
  /** Queue ids that must finish first (any terminal state counts, like a django-q Chain). */
  dependsOn?: number[];
}

export interface QueuedJob {
  id: number;
  kind: string;
  payload: any;
  status: string;
  lrj_id: string | null;
  group_id: string | null;
  attempts: number;
  max_attempts: number;
}

/** Enqueue inside the caller's transaction (tx from client.begin). Call wakeWorker() after commit. */
export async function enqueueIn(tx: Exec, kind: string, payload: unknown, opts: EnqueueOptions = {}) {
  const lrjId = opts.lrjId ?? (opts.lrj ? await lrjCreate(opts.lrj.jobType, opts.lrj.userId, tx) : null);
  const deps = `{${(opts.dependsOn ?? []).join(",")}}`;
  const [r] = await tx`INSERT INTO job_queue (kind, payload, lrj_id, group_id, run_after, max_attempts, depends_on)
    VALUES (${kind}, ${JSON.stringify(payload ?? {})}::text::jsonb, ${lrjId}, ${opts.groupId ?? null},
            COALESCE(${opts.runAfter ?? null}::timestamptz, now()), ${Math.max(1, opts.maxAttempts ?? 1)}, ${deps}::bigint[])
    RETURNING id`;
  return { id: Number(r.id), lrjId };
}

/** Enqueue one untracked job of kind per payload in a single INSERT. */
export async function enqueueManyIn(tx: Exec, kind: string, payloads: unknown[]): Promise<number> {
  if (!payloads.length) return 0;
  const r = await tx`INSERT INTO job_queue (kind, payload, run_after, max_attempts)
    SELECT ${kind}, p.value, now(), 1 FROM jsonb_array_elements(${JSON.stringify(payloads)}::text::jsonb) WITH ORDINALITY AS p(value, ord) ORDER BY p.ord RETURNING 1`;
  return r.length;
}

/** Enqueue as its own transaction and wake the local worker. */
export async function enqueue(kind: string, payload: unknown, opts: EnqueueOptions = {}) {
  const out = await client.begin((tx) => enqueueIn(tx as unknown as Exec, kind, payload, opts));
  wakeWorker();
  return out;
}

// ------------------------------------------------------------- registry

export interface JobCtx {
  job: QueuedJob;
  payload: any;
  lrjId: string | null;
  progress: Progress;
  isCancelled(): Promise<boolean>;
}
export type JobHandler = (ctx: JobCtx) => Promise<void>;

const handlers = new Map<string, JobHandler>();
export function registerJob(kind: string, handler: JobHandler) {
  handlers.set(kind, handler);
}
export const registeredKinds = () => [...handlers.keys()];
/** The handler of a kind (cli.ts run-job runs one inline). */
export const handlerFor = (kind: string) => handlers.get(kind);

// --------------------------------------------------------------- worker

const WORKER_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`;
let wake: (() => void) | null = null;
let stopping = false;

/** Poke the in-process worker (after enqueue commits). */
export function wakeWorker() {
  wake?.();
}

async function claimNext(kinds: string[]): Promise<QueuedJob | null> {
  const r = await client`UPDATE job_queue SET status = 'running', locked_by = ${WORKER_ID}, heartbeat_at = now(),
      started_at = COALESCE(started_at, now()), attempts = attempts + 1
    WHERE id = (SELECT j.id FROM job_queue j
                WHERE j.status = 'queued' AND j.run_after <= now() AND j.kind = ANY(${arrayLiteral(kinds)}::text[])
                  AND (cardinality(j.depends_on) = 0 OR NOT EXISTS (
                    SELECT 1 FROM job_queue d WHERE d.id = ANY(j.depends_on) AND d.status IN ('queued', 'running')))
                ORDER BY j.run_after, j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    RETURNING id, kind, payload, status, lrj_id, group_id, attempts, max_attempts`;
  if (!r.length) return null;
  return { ...r[0], id: Number(r[0].id) };
}

const backoffMs = (attempts: number) => Math.min(5000 * 2 ** (Math.min(Math.max(attempts, 1), 16) - 1), 600_000);

async function runJob(job: QueuedJob) {
  const started = performance.now();
  const hb = setInterval(() => {
    client`UPDATE job_queue SET heartbeat_at = now() WHERE id = ${job.id} AND status = 'running'`.catch(() => {});
  }, 10_000);
  let error: string | null = null;
  const handler = handlers.get(job.kind);
  try {
    if (!handler) throw new Error(`no handler for job kind ${JSON.stringify(job.kind)}`);
    const progress = new Progress(job.lrj_id);
    await handler({
      job,
      payload: job.payload,
      lrjId: job.lrj_id,
      progress,
      isCancelled: async () => (job.lrj_id ? lrjIsCancelled(job.lrj_id) : false),
    });
    await progress.flush();
  } catch (e) {
    error = e instanceof Error ? `${e.message}` : String(e);
    if (process.env.LP_JOB_TRACE) console.error(e);
  } finally {
    clearInterval(hb);
  }
  try {
    if (error === null) {
      await client`UPDATE job_queue SET status = 'done', finished_at = now(), locked_by = NULL WHERE id = ${job.id} AND status = 'running'`;
      console.log(`job ${job.id} ${job.kind} done in ${Math.round(performance.now() - started)} ms`);
    } else {
      const retryAt = new Date(Date.now() + backoffMs(job.attempts));
      const r = await client`UPDATE job_queue SET
          status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
          run_after = CASE WHEN attempts < max_attempts THEN ${retryAt}::timestamptz ELSE run_after END,
          finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
          locked_by = NULL, last_error = ${error}
        WHERE id = ${job.id} AND status = 'running' RETURNING status`;
      const final = r[0]?.status === "failed";
      console.warn(`job ${job.id} ${job.kind} failed (attempt ${job.attempts}, final ${final}): ${error}`);
      // A fan-out child (group_id set) shares its parent's LongRunningJob.
      if (final && job.group_id === null && job.lrj_id) await lrjFail(job.lrj_id, error);
    }
  } catch (e) {
    console.error(`recording the outcome of job ${job.id} failed`, e);
  }
}

/** Crash recovery: running rows with a stale heartbeat go back to queued (or fail after too many losses). */
async function requeueStale(staleSecs = 120) {
  await client`WITH lost AS (
      UPDATE job_queue SET status = 'failed', finished_at = now(), locked_by = NULL, last_error = 'worker lost (stale heartbeat)'
      WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => ${staleSecs}) AND attempts >= max_attempts + 2
      RETURNING lrj_id, group_id)
    UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(),
      result = '{"status": "failed", "error": "worker lost (stale heartbeat)"}'::jsonb
    WHERE NOT finished AND job_id IN (SELECT lrj_id FROM lost WHERE lrj_id IS NOT NULL AND group_id IS NULL)`;
  await client`UPDATE job_queue SET status = 'queued', locked_by = NULL
    WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => ${staleSecs})`;
}

const maintenanceTasks: (() => Promise<void>)[] = [];
/** Something to run every 30 s next to the worker (schedules, pruning). */
export function registerMaintenance(fn: () => Promise<void>) {
  maintenanceTasks.push(fn);
}

/** The embedded worker: WORKER_CONCURRENCY slots, 1 s poll plus in-process wakeups. */
export async function runWorker(concurrency: number) {
  const kinds = registeredKinds();
  console.log(`job worker ${WORKER_ID}: ${kinds.length} kinds, ${concurrency} slots`);
  await requeueStale().catch((e) => console.warn("stale requeue failed", e));
  const maint = setInterval(async () => {
    await requeueStale().catch((e) => console.warn("stale requeue failed", e));
    for (const t of maintenanceTasks) await t().catch((e) => console.warn("maintenance task failed", e));
  }, 30_000);
  let running = 0;
  let waiter: (() => void) | null = null;
  const signal = () => {
    const w = waiter;
    waiter = null;
    w?.();
  };
  wake = signal;
  while (!stopping) {
    if (running < concurrency && kinds.length) {
      let job: QueuedJob | null = null;
      try {
        job = await claimNext(kinds);
      } catch (e) {
        console.warn("claiming a job failed", e);
      }
      if (job) {
        running++;
        runJob(job).finally(() => {
          running--;
          signal();
        });
        continue;
      }
    }
    await new Promise<void>((resolve) => {
      waiter = resolve;
      setTimeout(signal, 1000);
    });
  }
  clearInterval(maint);
}

export function stopWorker() {
  stopping = true;
  wakeWorker();
}
