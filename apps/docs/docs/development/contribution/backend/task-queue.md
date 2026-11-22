---
title: "Task queue and parallel workers"
description: "Design of the task queue that replaces django-q2, and of the memory-aware worker count (#3073)."
sidebar_position: 7
---

<Since version="1.7.0" /> Status: phases 0 to 4 are in: the queue runs every job, `manage.py run_workers` replaced
`qcluster`, django-q2 is gone (its tables stay one release for the upgrade), and Scan Faces fans out. The later
phases land one pull request at a time.

This page is the plan for [#3073](https://github.com/LibrePhotos/librephotos/issues/3073): a queue that
LibrePhotos owns, so that the number of parallel workers can follow what the machine (or the container)
really has, and so that parallel lanes do their work once.

## Why not keep django-q2

Every enqueue already goes through one seam, `apps/backend/api/jobs/queue.py`. Behind it, LibrePhotos
works around django-q2 in many places:

| Need | Today | Where |
|---|---|---|
| A task of a dead cluster runs again | a broker subclass with a renewed 10-minute lease (#2852, #2876) | `api/jobs/broker.py` |
| An old container must not run the new release's tasks | the same subclass checks for unknown migrations before each dequeue (#2848) | `api/jobs/broker.py` |
| A task whose function moved fails once, not forever | a tolerant unpickler and a hand-written failure record (#2945) | `api/jobs/broker.py` |
| Stuck-job cleanup knows which jobs are alive | unpickles every queued payload (`held_job_ids`, #2879) | `api/jobs/queue.py` |
| Cancel drops the queued tasks of a job | unpickles every queued payload (`remove_queued_tasks`) | `api/jobs/queue.py` |
| Nominatim gets at most one request per second | a file-locked SQLite database per host (django-q2#350 stalled) | `api/geocode/rate_limit.py` |
| How many workers | `cpu_count()` of the host, ignoring a container limit; 2 in the standalone build | `settings/production.py`, `settings/standalone.py` |
| Memory | `max_rss` and `recycle`, checked only between tasks | `Q_CLUSTER` |

Payloads are pickles: 37 enqueue sites pickle a whole `User`, a moved function breaks the queue, and
nothing can be read from a queued task without unpickling it. A chain continues after a cancelled or failed
step, which is how a cancelled Generate Face Embeddings started four Find Similar Faces at once (#3073).

The queue below is about 1,000 lines with tests, replaces `broker.py` and `rate_limit.py`, and keeps the
seam's functions, so the ~49 call sites do not change.

## Tables

All in the `api` app, written only by `api/jobs/` (the models hold data and queries, as everywhere).

**`api_queuedtask`**, one row per task:

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint pk | claim order within a priority |
| `func` | varchar(200) | dotted path of the function, resolved with `pydoc.locate` when the task runs |
| `args`, `kwargs` | JSON | the arguments, encoded by `api/jobs/payload.py` (below) |
| `queue` | varchar(32) | `default`, `heavy` (faces, captions, tags, OCR), `geocode` |
| `priority` | smallint | higher first; follow-ups of a running job get `+1` so its tail is not starved |
| `status` | varchar(10) | `waiting` (behind a chain step or a group), `queued`, `running`, `failed`, `cancelled` |
| `run_after` | timestamp | not claimed before; also the retry backoff |
| `lease_until`, `worker` | timestamp, varchar | the running task's lease and who holds it |
| `attempts`, `max_attempts` | smallint | a task is retried until `max_attempts` (default 3), then `failed` |
| `after` | fk self, null | chain: this row is `waiting` until that one ends |
| `continue_on_error` | bool | run even when `after` failed or its job was cancelled (today's chains need it) |
| `group` | fk `api_taskgroup`, null | member of a barrier group, or (with `status=waiting`) its follow-up |
| `dedupe_key` | varchar(200), null | unique among `waiting`/`queued`/`running` rows (partial unique index) |
| `job_id` | varchar(36), null, indexed | the `LongRunningJob` the task belongs to, read from its `job_id` argument |
| `error` | text | the last failure, for the admin and the error report |
| `created_at`, `started_at`, `finished_at` | timestamps | |

A task that succeeds is deleted in the transaction that ends it; `failed` and `cancelled` rows are kept
for 7 days (the daily old-job cleanup deletes them). Indexes: `(status, queue, priority desc, id)`
partial on `status='queued'`, `(job_id)`, `(status, lease_until)` partial on `status='running'`.

**`api_taskgroup`**: `id`, `total`, `ended` (counter), `fired` (bool). **`api_taskschedule`**: `name`
(unique, null), `func`, `args`, `kwargs`, `schedule_type` (`O` once, `I` minutes, `H` hourly, `D` daily:
the letters django-q2 used), `minutes`, `next_run`, `intended_date_kwarg`, `last_run`.
**`api_workerprocess`**: one row per live worker (`name`, `host`, `pid`, `slot`, `started_at`,
`heartbeat_at`, `rss_mb`, `task_id`, `recycled_for`): the admin's Workers panel reads it.
**`api_throttle`**: `key` (pk), `next_at`.

### Payloads

`api/jobs/payload.py` encodes `None`, `bool`, `int`, `float`, `str`, lists, tuples, dicts with string keys,
`UUID`, `datetime`, `date`, and a model instance as `{"__model__": "api.user", "pk": 1}`. The worker loads
the instance again when the task runs, so a task works on the row as it is then, not on a copy from when
it was queued, and call sites keep passing `user`. Anything else is a `TypeError` at enqueue time, in the
request that queued it, not in the worker.

## Claiming

A worker claims one task per transaction. On PostgreSQL:

```sql
UPDATE api_queuedtask
   SET status = 'running', worker = %(worker)s, attempts = attempts + 1,
       started_at = now(), lease_until = now() + interval '10 minutes'
 WHERE id = (SELECT id FROM api_queuedtask
              WHERE status = 'queued' AND run_after <= now() AND queue = ANY(%(queues)s)
              ORDER BY priority DESC, id
              LIMIT 1
              FOR UPDATE SKIP LOCKED)
RETURNING id, func, args, kwargs, job_id, attempts;
```

`SKIP LOCKED` lets N workers claim in parallel without waiting for each other. SQLite has no row locks:
there the same `SELECT ... LIMIT 1` and `UPDATE ... WHERE id = ? AND status = 'queued'` run in one
`BEGIN IMMEDIATE` transaction (`transaction_mode=IMMEDIATE`, `settings/_sqlite.py`), which takes the
database's write lock first, so claims are serialised and never double. Both go through the ORM
(`select_for_update(skip_locked=True)`, which Django leaves out on SQLite).

The queues a worker asks for depend on the caps: `heavy` only while fewer than `heavy_width` heavy tasks
run, `geocode` while none runs. The count and the claim share the transaction; on PostgreSQL a
`pg_advisory_xact_lock` per capped queue makes the count exact across hosts.

**Leases.** Each worker renews `lease_until` of its task every minute from a thread. The supervisor
requeues the task of a worker it saw die at once; any supervisor requeues a `running` row whose lease
ran out (a host that went away) within a minute. A requeued task with `attempts >= max_attempts` becomes
`failed`, so a photo that kills its worker every time stops after three tries instead of looping.

**Release guard.** Before each claim a worker checks, with one `count(*)` of `django_migrations`, whether
anything was applied since its last look, and only then compares names (`unknown_applied_migrations`).
When the database has a migration this code lacks, the worker stops claiming and the old container's
tasks finish under their leases (#2848).

**A task whose function is gone** fails at claim time with "`<path>` no longer exists, an older release
queued it", without retries (#2945).

## Processes

```
manage.py run_workers  (supervisor: one per host or container)
├── scheduler thread     due schedules → tasks, catch_up=False
├── reaper thread        expired leases → queued / failed; leases of dead workers at once
├── capacity thread      every 30 s: capacity check → width W (shared multiprocessing.Value)
└── worker 0 .. N_max-1  spawned processes; worker i claims only while i < W
      └── lease thread, memory watchdog thread
```

- The supervisor replaces `qcluster`, its sentinel, pusher and monitor. Workers are started with
  multiprocessing `spawn` on every platform, so Linux and Windows behave alike, and in the standalone
  build from the `librephotos-worker` link as today.
- `N_max` processes start; `W` (the effective width) changes at runtime without a restart, from the
  setting, the capacity check and the memory left. Workers above `W` idle on a 1 s poll and cost their
  idle RSS (~110 MB), which the budget counts.
- **Stop.** POSIX: `SIGTERM`/`SIGINT`. Windows has no `SIGTERM`, so the standalone launcher starts the
  supervisor with `--stop-on-stdin-eof` and a pipe on stdin; closing it (or the launcher dying) is the
  stop. The supervisor sets a shared stop event, workers finish their task, and after 25 s the rest are
  killed and their tasks requeued. Processes are always stopped by PID tree, never by a command-line
  filter.
- **Graceful in the task.** `api.jobs.worker_runtime.checkpoint()` raises `WorkerStopping` (a
  `BaseException`, so a task's `except Exception` does not swallow it) when the worker must stop or
  recycle. A task that calls it between items (the Scan Faces chunk, Generate Face Embeddings) is
  requeued without an attempt and resumes: its items are counted once (`CountedJobItem`), and the chunk
  skips photos already counted.

## Chains, groups, deduplication, cancel

- **Chain.** `enqueue_chain` writes every step at once: the first `queued`, each next one `waiting` with
  `after` on the previous. When a step ends, its successor becomes `queued` if the step succeeded (the
  task returned and its job row is neither cancelled nor failed), else it is `cancelled` together with its
  job row ("an earlier step did not finish") and the rest of the chain, unless the successor has
  `continue_on_error`. The scan's follow-ups and the model download before a scan keep today's behaviour
  with `continue_on_error=True`; new chains stop by default.
- **Group barrier.** `enqueue_group(tasks, then=step)` writes a `taskgroup` with `total = len(tasks)`, the
  members, and the follow-up as `waiting`. Whenever a member ends (succeeded, failed after its last
  attempt, or cancelled), the same transaction runs `UPDATE api_taskgroup SET ended = ended + 1` and
  reads it back; the transaction that brings `ended` to `total` sets `fired` and queues the follow-up.
  Failed and cancelled members count as ended, so the follow-up always runs exactly once; it decides
  itself what to do about a cancelled job.
- **Dedupe.** A partial unique index on `dedupe_key` where `status in ('waiting','queued','running')`.
  `enqueue_followup(..., dedupe_key=...)` inserts the job row and the task in a savepoint; on the
  `IntegrityError` it rolls both back and returns the existing job. Generate Face Embeddings and Find
  Similar Faces queued by Scan Faces use `faces:embeddings:<user>` and `faces:cluster:<user>`.
- **Cancel** is `UPDATE api_queuedtask SET status='cancelled' WHERE job_id = %s AND status IN
  ('waiting','queued')`, plus the chain rule above for their successors and the group rule for their
  barrier. No payload is opened. A running task still checks its job row (`stop_if_cancelled`).
- **Enqueue is transactional.** The task row is written in the transaction that writes the job row, so
  `transaction.on_commit` and the "could not queue the job" failure path go away: either both exist or
  neither.
- **`held_job_ids`** for the stuck-job cleanup is `SELECT DISTINCT job_id ... WHERE status IN
  ('waiting','queued','running')`.

## Scheduler

`api_taskschedule` replaces `django_q_schedule` with the four types in use. The scheduler thread looks
every 5 s for `next_run <= now`, and fires a schedule with a conditional update (`SET next_run = <next>
WHERE id = %s AND next_run = <the value it read>`), so two supervisors never fire it twice. `catch_up` is
off: the next run is the first one after now, so a minutely schedule missed for an hour runs once
(today's `"catch_up": False`, #2848). `ONCE` rows are deleted when they fire. With `intended_date_kwarg`
the task gets the run's due time in ISO format, as django-q2 passed it. The `start_*` management
commands still create the schedules at boot, through the same `ensure_schedule`/`replace_schedule`.

## Throttle

<Since version="1.7.0" /> Up to 1.6.0 the geocoding rate limit was a file-locked SQLite database under
`BASE_DATA` (`geocode_rate_limit.sqlite3`), which only held on one host. That file is no longer used.

`api/jobs/throttle.py` `wait(key, seconds)`: `UPDATE api_throttle SET next_at = now + seconds WHERE key =
%s AND next_at <= now`; one row updated means go, otherwise sleep until `next_at` and try again. It is in
the main database, so it holds across processes and across hosts (the file lock it replaces only held on
one host). Reverse geocoding calls it per provider (Nominatim 1.1 s), and geolocation tasks run in the
`geocode` queue, capped at one at a time, so the other workers do other work instead of sleeping.

## Memory

- **Hard limit per worker.** The watchdog thread reads the worker's RSS every 2 s; above
  `hard_limit` it requeues the task (an attempt counts) and exits at once. The supervisor starts a new
  worker and records `recycled_for` (shown in the admin).
- **Soft limit per worker.** Above `soft_limit` (`0.75 × hard_limit`) the next `checkpoint()` raises
  `WorkerStopping`: the task is requeued without an attempt and the worker exits to be replaced. A task
  without checkpoints finishes first. This covers the inside of long tasks, which `max_rss` never did.
- **Machine.** When the capacity check sees less than `low_water` available memory (the larger of
  512 MB and 10 % of the limit), it lowers `W` by one per round, down to 1; it raises it back by one per
  round once there is room again.
- `hard_limit` defaults to `max(600 MB, lane_ram)` and can be set (`WORKER_MEMORY_LIMIT_MB`).

## Capacity and the worker count

`api/runtime/capacity.py` has no Django imports, so sidecars can use it.

| Quantity | Linux, Docker, Kubernetes | Windows |
|---|---|---|
| RAM total | `min(host, cgroup)`: v2 `memory.max`, v1 `memory.limit_in_bytes` | `min(host, Job Object limit)` (`QueryInformationJobObject`) |
| RAM available | `min(host available, limit - (usage - inactive_file))` | host available |
| Cores | `os.process_cpu_count()` (affinity, `--cpuset-cpus`), capped by `cpu.max` or `cfs_quota_us / cfs_period_us` | `os.process_cpu_count()` |
| GPU, VRAM | `nvidia-smi` through `api.runtime.binaries`; unknown otherwise | same |

```
budget  = 0.6 × available at start (0.8 for Fast), at most 0.8 × total
fixed   = server + supervisor + running sidecars (measured RSS once they run; 1.5 GB to start)
N_cpu   = Gentle 1 · Balanced clamp(cores // 2, 1, 4) · Fast clamp(cores - 1, 1, 8)
N_ram   = floor((budget - fixed) / lane_ram)            lane_ram: 600 MB light, 750 MB heavy (CPU)
N_vram  = floor((vram_free - 512 MB) / vram_per_lane)   only with a GPU provider
W       = max(1, min(N_cpu, N_ram, N_vram, WORKER_CONCURRENCY if set))
heavy_width = max(1, min(W, N_ram_heavy, N_vram))
```

On SQLite `W` is capped at 4: one writer, more lanes only wait for it. N never drops below 1; when even
one lane does not fit the admin sees a warning and LibrePhotos runs slowly instead of not at all.

**The setting.** `PARALLEL_WORKERS` (site setting): `gentle`, `balanced` (default), `fast`. *Fast first
import* switches itself back to *Balanced* once the queue has been empty for 10 minutes after a completed
library scan. `WORKER_CONCURRENCY` stays a hard override (also of `N_max`). `N_max` is `W` of *Fast* at
start, so switching up needs no restart unless the machine got bigger.

**Where it shows.** The first-time setup gets a step after the library path: what was detected ("4 cores,
8 GB (container limit), no GPU"), the three intentions with the resulting workers and memory budget each,
and a warning when the choice does not fit ("4 workers need about 3 GB, this container has 2 GB; 2 will
run"). The same control is in Settings (admin) and the admin's server stats show the running width, the
budget in use and the recycles.

## Scan Faces in parallel

`scan_faces` lists the photos once (as today), then queues `scan_faces_chunk(job_id, photo_ids)` tasks of
64 photos in the `heavy` queue, as one group whose follow-up is `finish_face_scan(job_id)`. Each chunk
counts its photos with an item key, so a redelivered chunk counts nothing twice. With one worker the
chunks run in listing order, which is today's order. The follow-up runs once, after the last chunk,
whatever happened to the others: when the job was cancelled it does nothing; otherwise it completes the
job and queues Generate Face Embeddings, then Find Similar Faces, as a stopping chain with the dedupe keys
above. The 20-in-a-row "face service unreachable" counter moves into the job's result, so it spans chunks.

This does not touch the clustering itself. @metamountain's fixes on `faces-large-libraries` (batched
`pk__in` for SQLite's 32,766-variable limit, counting a person once per photo) are independent of it.

## Upgrade from django-q2

- **Schedules** (no pickles: `func` is a dotted path, `args` a Python literal) are copied into
  `api_taskschedule` by a migration that reads `django_q_schedule` with raw SQL when the table exists,
  keeps `next_run`, maps the functions moved in 1.5.0 (#2335, what 0157 and 0158 did), and deletes what it
  copied. It runs before the `start_*` commands, which then find their schedules and create nothing twice.
- **Queued tasks** are signed pickles, so they are read at runtime, not in a migration: on start and every
  minute while `django_q_ormq` has rows, the supervisor takes the rows whose lock has expired (a task an
  old cluster still holds during a rolling deploy is left to it until its lease ends), checks each
  signature with `SECRET_KEY` and the cluster name, unpickles it with the tolerant unpickler from
  `broker.py`, encodes function, arguments and the remaining chain as a new task, and deletes the old row
  in the same transaction. A payload that cannot be read is dropped with a warning, and its job, if it
  has one that has not started, is failed with "queued before the upgrade; start it again". So nothing
  runs twice, and nothing is lost silently.
- django-q2 leaves `INSTALLED_APPS` and the requirements; its tables stay one release so the step above
  can read them, and a migration in the release after drops them (`DROP TABLE IF EXISTS`).

## Tests

- Unit: payload codec round trip and refusal; claim order and caps; lease renewal and expiry; attempts;
  chain stop and `continue_on_error`; group barrier with failed and cancelled members; dedupe while
  queued and running; cancel without payloads; scheduler types, `catch_up=False`, two schedulers;
  release guard; throttle; capacity against fake cgroup v1/v2 trees, a Job Object stub and a fake
  `nvidia-smi`; the formula as a table.
- Multi-process, on SQLite and PostgreSQL: N processes claim 2,000 tasks, every task runs once; a
  worker killed mid-task, lease expiry, exactly one rerun; a supervisor restart while tasks run.
- Upgrade: a database with pickled `django_q_ormq` tasks (with `User` arguments, a chain, a moved
  function, a bad signature) and `django_q_schedule` rows is converted, nothing runs twice.
- Throughput and memory: a real scan of a demo library (and Scan Faces on a copy of a 100k-photo
  SQLite database) on django-q2 and on the new queue, one and four workers: photos per hour and peak RSS.
- CI runs the suite on SQLite; a job with a `postgres` service container runs the queue tests on
  PostgreSQL.

## Phases

| # | Pull request | Depends on |
|---|---|---|
| 0 | This design | |
| 1 | `api/runtime/capacity.py`; the admin server stats show the container's memory and cores. No behaviour change | |
| 2 | Queue core: tables, payload codec, claim, worker, supervisor, scheduler, throttle, tests (multi-process on both databases). Not wired in yet | 0 |
| 3 | Switch-over: the seam on the new queue, `run_workers` in every entry point, the upgrade step and migration; django-q2, `broker.py`, `rate_limit.py` and the Nuitka includes removed | 2 |
| 4 | Scan Faces chunks, group barrier, unique follow-ups, stopping chains | 3 |
| 5 | `PARALLEL_WORKERS`, width from capacity at runtime, heavy cap, memory watchdog | 1, 3 |
| 6 | First-time setup step, settings and admin UI, docs (Docker `mem_limit`, Raspberry Pi, ARM64, NAS) | 5 |

Later, each with its own design: several face sidecars, one per heavy lane (VRAM in the budget, a lease
per replica); hard limits from the operating system (`oom_score_adj` +500 for workers and sidecars so the
kernel picks them before the web server, a per-sidecar Job Object memory limit in the standalone build);
fair sharing of lanes between users on multi-user servers (claim from the user served least recently);
one pass instead of three over a new photo (#3071, request B).
