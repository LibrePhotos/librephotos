/**
 * @jest-environment node
 *
 * The worker loop: claim → run → record → chain → yield. What is tested here is
 * the *driver*, with trivial handlers — the real handlers get their cover in
 * ./chaining.test.ts and ../../__tests__/pipeline.test.ts.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { claimNextJob, enqueueJob, enqueueJobs, getJob } from "../queue";
import { runWorker, resetBootReclaimForTests, type JobHandlers } from "../worker";
import { MAX_JOB_ATTEMPTS } from "../types";

/** Synchronous yield: keeps the tests fast and deterministic. */
const fastYield = () => Promise.resolve();

function stateOf(t: TestDb, id: number): string {
  return (t.db.get(sql`SELECT state FROM job_queue WHERE id = ${id}`) as { state: string }).state;
}

describe("job worker", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
  });
  afterEach(() => t.close());

  it("drains the queue and records every job as done", async () => {
    const ran: string[] = [];
    enqueueJobs(t.db, [
      { kind: "outbox_replay" },
      { kind: "hash_batch" },
      { kind: "thumb_prefetch" },
    ]);
    const handlers: JobHandlers = {
      outbox_replay: async () => void ran.push("outbox_replay"),
      hash_batch: async () => void ran.push("hash_batch"),
      thumb_prefetch: async () => void ran.push("thumb_prefetch"),
    };

    const stats = await runWorker(t.db, { handlers, yield: fastYield });

    expect(ran).toEqual(["outbox_replay", "hash_batch", "thumb_prefetch"]);
    expect(stats.processed).toBe(3);
    expect(stats.succeeded).toBe(3);
    expect(stats.stoppedReason).toBe("drained");
    expect(
      (t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'done'`) as { c: number }).c
    ).toBe(3);
  });

  it("reclaims a running row left by a killed process before it starts", async () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    claimNextJob(t.db, 1_000); // process dies here, row stuck `running`

    let ran = 0;
    await runWorker(t.db, { handlers: { hash_batch: async () => void (ran += 1) }, yield: fastYield });

    // Without the boot reclaim this job is unreachable forever — the durable
    // equivalent of the reload that discarded the old pipeline's call stack.
    expect(ran).toBe(1);
  });

  it("runs the boot reclaim only once per process", async () => {
    const noop: JobHandlers = { hash_batch: async () => {} };
    enqueueJob(t.db, { kind: "hash_batch" });
    await runWorker(t.db, { handlers: noop, yield: fastYield });

    // A second drain must NOT steal a job another drain legitimately owns.
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    claimNextJob(t.db, 2_000);
    await runWorker(t.db, { handlers: noop, yield: fastYield });
    expect(stateOf(t, id)).toBe("running");
  });

  it("chains follow-up jobs enqueued by a handler", async () => {
    enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 0 } });
    const chunks: number[] = [];
    const handlers: JobHandlers = {
      device_scan: async ({ job }) => {
        const chunk = JSON.parse(job.payload ?? "{}").chunk as number;
        chunks.push(chunk);
        // A self-continuation: only legal because the worker records this job's
        // outcome before applying `enqueue`, freeing the dedupe key.
        return chunk < 3
          ? { enqueue: [{ kind: "device_scan", payload: { chunk: chunk + 1 } }] }
          : {};
      },
    };

    await runWorker(t.db, { handlers, yield: fastYield });
    expect(chunks).toEqual([0, 1, 2, 3]);
  });

  it("aggregates applied/deleted counts across jobs", async () => {
    enqueueJobs(t.db, [
      { kind: "remote_delta", payload: { entity: "photo" } },
      { kind: "remote_delta", payload: { entity: "person" } },
    ]);
    const stats = await runWorker(t.db, {
      handlers: { remote_delta: async () => ({ applied: 5, deleted: 2 }) },
      yield: fastYield,
    });
    expect(stats.applied).toBe(10);
    expect(stats.deleted).toBe(4);
    expect(stats.byKind.remote_delta).toBe(2);
  });

  it("retries a throwing job behind a backoff window, then parks it as failed", async () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    let calls = 0;
    const handlers: JobHandlers = {
      hash_batch: async () => {
        calls += 1;
        throw new Error("disk on fire");
      },
    };

    // First drain: one attempt, then the backoff window closes the queue.
    let now = 1_000;
    await runWorker(t.db, { handlers, yield: fastYield, now: () => now });
    expect(calls).toBe(1);
    expect(getJob(t.db, id)!.state).toBe("pending");
    expect(getJob(t.db, id)!.last_error).toBe("disk on fire");

    // Walk the clock past each window until the attempt cap is spent.
    for (let i = 1; i < MAX_JOB_ATTEMPTS; i += 1) {
      now += 10 * 60_000;
      await runWorker(t.db, { handlers, yield: fastYield, now: () => now });
    }
    expect(calls).toBe(MAX_JOB_ATTEMPTS);
    const row = getJob(t.db, id)!;
    expect(row.state).toBe("failed");
    expect(row.last_error).toBe("disk on fire");
  });

  it("a failing job does not block the jobs behind it", async () => {
    enqueueJobs(t.db, [{ kind: "hash_batch" }, { kind: "thumb_prefetch" }]);
    let thumbs = 0;
    const stats = await runWorker(t.db, {
      handlers: {
        hash_batch: async () => {
          throw new Error("nope");
        },
        thumb_prefetch: async () => void (thumbs += 1),
      },
      yield: fastYield,
    });
    // The old chain would have aborted the whole sequence here.
    expect(thumbs).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.succeeded).toBe(1);
  });

  it("parks a job with no registered handler instead of retrying it five times", async () => {
    const id = enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: "a1" } })!;
    await runWorker(t.db, { handlers: {}, yield: fastYield });
    expect(getJob(t.db, id)!.state).toBe("failed");
    expect(getJob(t.db, id)!.last_error).toContain("no handler");
  });

  it("stops on the job budget and leaves the rest claimable", async () => {
    enqueueJobs(t.db, [
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
      { kind: "upload_asset", payload: { assetId: "a3" } },
    ]);
    const stats = await runWorker(t.db, {
      handlers: { upload_asset: async () => {} },
      yield: fastYield,
      maxJobs: 2,
    });
    expect(stats.processed).toBe(2);
    expect(stats.stoppedReason).toBe("budget");
    expect(
      (t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'pending'`) as { c: number }).c
    ).toBe(1);
  });
});

describe("job worker: cancellation", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
  });
  afterEach(() => t.close());

  it("stops between jobs when the signal aborts", async () => {
    enqueueJobs(t.db, [
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
      { kind: "upload_asset", payload: { assetId: "a3" } },
    ]);
    const controller = new AbortController();
    let ran = 0;
    const stats = await runWorker(t.db, {
      handlers: {
        upload_asset: async () => {
          ran += 1;
          if (ran === 2) controller.abort();
        },
      },
      signal: controller.signal,
      yield: fastYield,
    });

    expect(ran).toBe(2);
    expect(stats.stoppedReason).toBe("cancelled");
    // The third is untouched and the second went back to pending — nothing is
    // lost when the app is backgrounded mid-drain.
    expect(
      (t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'pending'`) as { c: number }).c
    ).toBe(2);
  });

  it("releases the in-flight job with its attempt refunded rather than failing it", async () => {
    const id = enqueueJob(t.db, { kind: "hash_batch" })!;
    const controller = new AbortController();
    await runWorker(t.db, {
      handlers: {
        hash_batch: async ({ signal }) => {
          controller.abort();
          if (signal?.aborted) throw new Error("hash pass aborted");
        },
      },
      signal: controller.signal,
      yield: fastYield,
    });

    const row = getJob(t.db, id)!;
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0); // refunded — cancellation is not the job's fault
    expect(row.last_error).toBeNull();
    expect(row.started_at).toBeNull();
  });

  it("does nothing at all when the signal is already aborted", async () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    const controller = new AbortController();
    controller.abort();
    let ran = 0;
    const stats = await runWorker(t.db, {
      handlers: { hash_batch: async () => void (ran += 1) },
      signal: controller.signal,
      yield: fastYield,
    });
    expect(ran).toBe(0);
    expect(stats.stoppedReason).toBe("cancelled");
  });

  it("hands the signal to the handler so long work can bail mid-flight", async () => {
    enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 0 } });
    const controller = new AbortController();
    let sawSignal = false;
    await runWorker(t.db, {
      handlers: {
        device_scan: async ({ signal }) => {
          sawSignal = signal != null;
          controller.abort();
        },
      },
      signal: controller.signal,
      yield: fastYield,
    });
    expect(sawSignal).toBe(true);
  });
});
