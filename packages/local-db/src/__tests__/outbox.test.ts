import {
  OUTBOX_BACKOFF_MS,
  OUTBOX_MAX_ATTEMPTS,
  claimOutboxEntry,
  completeOutboxEntry,
  enqueueOutboxEntry,
  outboxCounts,
  outboxEntries,
  outboxPayload,
  rejectOutboxEntry,
  requeueOutboxEntry,
  resetInflightOutbox,
  retryOutboxEntry,
  retryStuckOutbox,
} from "../queries/outbox";
import { createTestDb, type TestDb } from "../testing";

describe("outbox", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("claims the oldest entry once and deletes it when done", async () => {
    const a = await enqueueOutboxEntry(t.db, "desktop_rating", { hash: "h1", rating: 3 }, { now: 1 });
    await enqueueOutboxEntry(t.db, "desktop_caption", { hash: "h1", caption: "x" }, { now: 2 });
    const first = await claimOutboxEntry(t.db, 10);
    expect(first).toMatchObject({ id: a, kind: "desktop_rating", state: "inflight", attempts: 0 });
    expect(first && outboxPayload(first)).toEqual({ hash: "h1", rating: 3 });
    expect((await claimOutboxEntry(t.db, 10))?.kind).toBe("desktop_caption");
    expect(await claimOutboxEntry(t.db, 10)).toBeNull();
    await completeOutboxEntry(t.db, a);
    expect(await outboxCounts(t.db)).toEqual({ pending: 0, inflight: 1, failed: 0, rejected: 0 });
  });

  it("keeps only the newest write per key", async () => {
    await enqueueOutboxEntry(t.db, "desktop_rating", { rating: 1 }, { key: "h1" });
    await enqueueOutboxEntry(t.db, "desktop_rating", { rating: 2 }, { key: "h2" });
    await enqueueOutboxEntry(t.db, "desktop_rating", { rating: 5 }, { key: "h1" });
    await enqueueOutboxEntry(t.db, "desktop_caption", { caption: "c" }, { key: "h1" });
    const entries = await outboxEntries(t.db, ["desktop_rating", "desktop_caption"]);
    expect(entries.map((e) => outboxPayload(e))).toEqual([{ rating: 2 }, { rating: 5 }, { caption: "c" }]);
  });

  it("backs off after a failure and gives up after the last attempt", async () => {
    const id = await enqueueOutboxEntry(t.db, "k", { a: 1 });
    await claimOutboxEntry(t.db, 0);
    await retryOutboxEntry(t.db, id, "offline", 1000);
    expect(await claimOutboxEntry(t.db, 1000 + OUTBOX_BACKOFF_MS - 1)).toBeNull();
    expect((await claimOutboxEntry(t.db, 1000 + OUTBOX_BACKOFF_MS))?.id).toBe(id);
    await retryOutboxEntry(t.db, id, "offline", 2000);
    expect(await claimOutboxEntry(t.db, 2000 + 2 * OUTBOX_BACKOFF_MS - 1)).toBeNull();
    for (let i = 2; i < OUTBOX_MAX_ATTEMPTS; i++) await retryOutboxEntry(t.db, id, "offline", 0);
    expect(await claimOutboxEntry(t.db, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(await outboxCounts(t.db, ["k"])).toEqual({ pending: 0, inflight: 0, failed: 1, rejected: 0 });
    expect(await retryStuckOutbox(t.db)).toBe(1);
    expect((await claimOutboxEntry(t.db, 0))?.attempts).toBe(0);
  });

  it("parks a rejected entry, puts back a requeued one and recovers inflight ones", async () => {
    const a = await enqueueOutboxEntry(t.db, "k", 1);
    const b = await enqueueOutboxEntry(t.db, "k", 2);
    await claimOutboxEntry(t.db);
    await rejectOutboxEntry(t.db, a, "400 bad");
    expect(await outboxCounts(t.db, ["other"])).toEqual({ pending: 0, inflight: 0, failed: 0, rejected: 0 });
    expect(await outboxCounts(t.db)).toMatchObject({ rejected: 1, pending: 1 });
    await claimOutboxEntry(t.db);
    await requeueOutboxEntry(t.db, b);
    expect((await claimOutboxEntry(t.db))?.id).toBe(b);
    expect(await resetInflightOutbox(t.db)).toBe(1);
    expect((await outboxEntries(t.db, ["k"])).map((e) => [e.id, e.state, e.last_error])).toEqual([
      [a, "rejected", "400 bad"],
      [b, "pending", null],
    ]);
  });
});
