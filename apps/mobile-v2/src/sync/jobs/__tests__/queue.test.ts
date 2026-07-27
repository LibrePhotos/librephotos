/**
 * @jest-environment node
 *
 * `job_queue` table ops against real SQLite. These are the invariants the whole
 * driver rests on: a claim is exclusive, a re-enqueue is idempotent, a crash is
 * recoverable, and priority decides who runs next.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import {
  claimNextJob,
  clearJobs,
  completeJob,
  enqueueJob,
  enqueueJobs,
  failJob,
  getJob,
  hasEligibleJob,
  nextJobDueAt,
  pendingJobCount,
  pruneJobs,
  reclaimStaleJobs,
  releaseJob,
  retryFailedJobs,
} from "../queue";
import { JOB_BACKOFF_BASE_MS, MAX_JOB_ATTEMPTS, jobBackoffDelay } from "../types";

function stateOf(t: TestDb, id: number): string {
  return (t.db.get(sql`SELECT state FROM job_queue WHERE id = ${id}`) as { state: string }).state;
}
function countAll(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue`) as { c: number }).c;
}

describe("job_queue: enqueue + dedupe", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("enqueues a job with the kind's default priority and dedupe key", () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" }, 1_000);
    expect(id).not.toBeNull();
    const row = getJob(t.db, id!)!;
    expect(row.kind).toBe("hash_batch");
    expect(row.dedupe_key).toBe("hash_batch");
    expect(row.state).toBe("pending");
    expect(row.priority).toBe(60);
    expect(row.attempts).toBe(0);
    expect(row.created_at).toBe(1_000);
  });

  it("drops a duplicate while an identical job is still live", () => {
    expect(enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 0 } })).not.toBeNull();
    // Every trigger, foreground event and chained job re-requests this work; it
    // must collapse onto the one outstanding row rather than pile up.
    expect(enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 1 } })).toBeNull();
    expect(enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 2 } })).toBeNull();
    expect(countAll(t)).toBe(1);
  });

  it("dedupes per entity / per asset, not across them", () => {
    const inserted = enqueueJobs(t.db, [
      { kind: "remote_delta", payload: { entity: "photo" } },
      { kind: "remote_delta", payload: { entity: "person" } },
      { kind: "remote_delta", payload: { entity: "photo" } }, // dup
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
      { kind: "upload_asset", payload: { assetId: "a1" } }, // dup
    ]);
    expect(inserted).toBe(4);
    expect(countAll(t)).toBe(4);
  });

  it("lets the same work be re-enqueued once the previous row has finished", () => {
    const first = enqueueJob(t.db, { kind: "hash_batch" })!;
    completeJob(t.db, first);
    // A finished row must not block the next pass — the dedupe index is partial
    // on (pending|running) precisely so a later sync can scan again.
    const second = enqueueJob(t.db, { kind: "hash_batch" });
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("does not dedupe against a job that is running — a continuation is a new row", () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    const claimed = claimNextJob(t.db, 1_000)!;
    expect(claimed.state).toBe("running");
    // While it runs, re-requesting is still a duplicate…
    expect(enqueueJob(t.db, { kind: "hash_batch" })).toBeNull();
    // …but once it settles, its own continuation goes in. This ordering is why
    // the worker records the outcome BEFORE enqueuing what the job chained.
    completeJob(t.db, claimed.id);
    expect(enqueueJob(t.db, { kind: "hash_batch" })).not.toBeNull();
  });
});

describe("job_queue: atomic claim", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("never hands the same job to two claimants", () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    const a = claimNextJob(t.db, 1_000);
    const b = claimNextJob(t.db, 1_000);
    expect(a).not.toBeNull();
    expect(b).toBeNull(); // the only job is already claimed
    expect(stateOf(t, a!.id)).toBe("running");
  });

  it("hands out distinct jobs to interleaved claimants", () => {
    enqueueJobs(t.db, [
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
      { kind: "upload_asset", payload: { assetId: "a3" } },
    ]);
    const claimed = [
      claimNextJob(t.db, 1_000),
      claimNextJob(t.db, 1_000),
      claimNextJob(t.db, 1_000),
      claimNextJob(t.db, 1_000),
    ];
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all different — no double-claim
    expect(claimed[3]).toBeNull();
  });

  it("increments attempts on claim, so a job that never reports back still ages", () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    expect(claimNextJob(t.db, 1_000)!.attempts).toBe(1);
    reclaimStaleJobs(t.db, 2_000);
    // Reclaim refunds the attempt: a crash is not evidence the job is bad.
    expect(getJob(t.db, id)!.attempts).toBe(0);
  });

  it("skips jobs whose backoff window has not opened", () => {
    enqueueJob(t.db, { kind: "hash_batch", notBefore: 5_000 });
    expect(claimNextJob(t.db, 1_000)).toBeNull();
    expect(hasEligibleJob(t.db, 1_000)).toBe(false);
    expect(nextJobDueAt(t.db)).toBe(5_000);
    expect(claimNextJob(t.db, 5_000)).not.toBeNull();
  });
});

describe("job_queue: priority ordering", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("runs interactive work before background work regardless of insertion order", () => {
    // Deliberately enqueued worst-first: ordering must come from priority, not
    // from the order the caller happened to ask.
    enqueueJobs(t.db, [
      { kind: "integrity_check" }, // 95
      { kind: "thumb_prefetch" }, // 90
      { kind: "hash_batch" }, // 60
      { kind: "remote_delta", payload: { entity: "photo" } }, // 20
      { kind: "outbox_replay" }, // 10
    ]);
    const order: string[] = [];
    for (;;) {
      const job = claimNextJob(t.db, 1_000);
      if (!job) break;
      order.push(job.kind);
      completeJob(t.db, job.id);
    }
    expect(order).toEqual([
      "outbox_replay",
      "remote_delta",
      "hash_batch",
      "thumb_prefetch",
      "integrity_check",
    ]);
  });

  it("round-robins the three background stages by insertion order (same priority)", () => {
    // device_scan / hash_batch / upload_asset deliberately share priority 60.
    // Distinct priorities would let the best-ranked one monopolise the worker —
    // which is the strict chain this queue replaced, re-implemented in data.
    enqueueJobs(t.db, [
      { kind: "device_scan", payload: { chunk: 0 } },
      { kind: "hash_batch" },
      { kind: "upload_asset", payload: { assetId: "a1" } },
    ]);
    const order: string[] = [];
    for (;;) {
      const job = claimNextJob(t.db, 1_000);
      if (!job) break;
      order.push(job.kind);
      completeJob(t.db, job.id);
    }
    expect(order).toEqual(["device_scan", "hash_batch", "upload_asset"]);
  });
});

describe("job_queue: retry + backoff", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("returns a failed job to pending behind an exponential window", () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    const job = claimNextJob(t.db, 1_000)!;
    const outcome = failJob(t.db, job, "boom", 1_000);

    expect(outcome.state).toBe("pending");
    expect(outcome.retryAt).toBe(1_000 + JOB_BACKOFF_BASE_MS); // attempts=1 ⇒ base * 2^0
    const row = getJob(t.db, job.id)!;
    expect(row.state).toBe("pending");
    expect(row.last_error).toBe("boom");
    expect(row.started_at).toBeNull();
    expect(claimNextJob(t.db, 1_000)).toBeNull(); // still inside the window
  });

  it("widens the window with each attempt and caps it", () => {
    expect(jobBackoffDelay(1)).toBe(JOB_BACKOFF_BASE_MS);
    expect(jobBackoffDelay(2)).toBe(JOB_BACKOFF_BASE_MS * 2);
    expect(jobBackoffDelay(3)).toBe(JOB_BACKOFF_BASE_MS * 4);
    // Capped, so a long-parked job still gets another go this session rather
    // than drifting out to an hour.
    expect(jobBackoffDelay(50)).toBe(5 * 60_000);
  });

  it("becomes terminally failed at the attempt cap, keeping the error", () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    let now = 1_000;
    for (let i = 0; i < MAX_JOB_ATTEMPTS; i += 1) {
      const job = claimNextJob(t.db, now);
      expect(job).not.toBeNull();
      failJob(t.db, job!, `boom ${i}`, now);
      now += jobBackoffDelay(i + 1) + 1;
    }
    const row = getJob(t.db, id)!;
    expect(row.state).toBe("failed");
    expect(row.attempts).toBe(MAX_JOB_ATTEMPTS);
    expect(row.last_error).toBe(`boom ${MAX_JOB_ATTEMPTS - 1}`);
    // Terminal means terminal: it will not be claimed again on its own.
    expect(claimNextJob(t.db, now + 10 * 60_000)).toBeNull();
  });

  it("retryFailedJobs revives terminal failures for the user's retry button", () => {
    const id = enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: "a1" } })!;
    const job = claimNextJob(t.db, 1_000)!;
    failJob(t.db, { id: job.id, attempts: MAX_JOB_ATTEMPTS }, "nope", 1_000);
    expect(stateOf(t, id)).toBe("failed");

    expect(retryFailedJobs(t.db)).toBe(1);
    const row = getJob(t.db, id)!;
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
  });

  it("retryFailedJobs drops a failure whose work has already been re-requested", () => {
    const stale = enqueueJob(t.db, { kind: "hash_batch" })!;
    const job = claimNextJob(t.db, 1_000)!;
    failJob(t.db, { id: job.id, attempts: MAX_JOB_ATTEMPTS }, "nope", 1_000);
    // A newer row now carries the same dedupe key…
    const fresh = enqueueJob(t.db, { kind: "hash_batch" })!;

    retryFailedJobs(t.db);
    // …so reviving the old one would violate the uniqueness guarantee. The
    // newer row wins and the stale failure is discarded.
    expect(getJob(t.db, stale)).toBeNull();
    expect(getJob(t.db, fresh)!.state).toBe("pending");
  });
});

describe("job_queue: crash recovery", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("reclaims a `running` row left behind by a killed process", () => {
    enqueueJobs(t.db, [{ kind: "hash_batch" }, { kind: "device_scan", payload: { chunk: 0 } }]);
    const a = claimNextJob(t.db, 1_000)!;
    const b = claimNextJob(t.db, 1_000)!;
    expect(stateOf(t, a.id)).toBe("running");
    expect(stateOf(t, b.id)).toBe("running");

    // The process dies here. Nothing marks these done or failed; without a
    // reclaim they would wedge forever, exactly as the old pipeline wedged when
    // a reload discarded the call stack.
    expect(reclaimStaleJobs(t.db, 2_000)).toBe(2);
    expect(stateOf(t, a.id)).toBe("pending");
    expect(stateOf(t, b.id)).toBe("pending");
    expect(getJob(t.db, a.id)!.started_at).toBeNull();
    // Reclaimed work is immediately claimable again — no backoff penalty.
    expect(claimNextJob(t.db, 2_000)).not.toBeNull();
  });

  it("honours a staleness threshold so a mid-session sweep spares live jobs", () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    claimNextJob(t.db, 10_000);
    // Claimed 5s ago; a 60s threshold must leave it alone.
    expect(reclaimStaleJobs(t.db, 15_000, 60_000)).toBe(0);
    expect(reclaimStaleJobs(t.db, 90_000, 60_000)).toBe(1);
  });

  it("releaseJob hands a cancelled job back with its attempt refunded", () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    claimNextJob(t.db, 1_000);
    expect(getJob(t.db, id)!.attempts).toBe(1);

    releaseJob(t.db, id);
    const row = getJob(t.db, id)!;
    expect(row.state).toBe("pending");
    // Backgrounding the app repeatedly must not exhaust a job's retry budget.
    expect(row.attempts).toBe(0);
    expect(row.next_attempt_at).toBe(0);
  });
});

describe("job_queue: housekeeping", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("prunes old `done` rows but keeps failures", () => {
    for (let i = 0; i < 12; i += 1) {
      const id = enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: `a${i}` } })!;
      completeJob(t.db, id);
    }
    const failed = enqueueJob(t.db, { kind: "hash_batch" })!;
    failJob(t.db, { id: failed, attempts: MAX_JOB_ATTEMPTS }, "kept", 1_000);

    expect(pruneJobs(t.db, 5)).toBe(7);
    expect((t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'done'`) as { c: number }).c).toBe(5);
    // Failures are the only record of a blocker, so they survive pruning.
    expect(getJob(t.db, failed)!.state).toBe("failed");
  });

  it("counts live work and clears the queue", () => {
    enqueueJobs(t.db, [{ kind: "hash_batch" }, { kind: "thumb_prefetch" }]);
    claimNextJob(t.db, 1_000);
    expect(pendingJobCount(t.db)).toBe(2); // pending + running are both "live"
    clearJobs(t.db);
    expect(countAll(t)).toBe(0);
  });
});
