/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { getSyncState } from "@/db/queries/sync-state";
import { getMetaNumber, META_FAVORITE_MIN_RATING } from "@/db/queries/app-meta";
import { recentSyncLog } from "@/db/queries/sync-log";
import { syncAll, needsInitialSeed, repairSync } from "../orchestrator";
import { createThrottle } from "../throttle";
import { FakeSource, emptyStore, photoItem } from "./fake-source";

function photoCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number }).c;
}

describe("orchestrator", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("needsInitialSeed is true until the photo entity completes", async () => {
    expect(needsInitialSeed(t.db)).toBe(true);
    const store = emptyStore();
    store.photo = [photoItem("p1")];
    await syncAll(t.db, new FakeSource(store));
    expect(needsInitialSeed(t.db)).toBe(false);
  });

  it("runs the full pull and reports applied counts", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1"), photoItem("p2")];
    const res = await syncAll(t.db, new FakeSource(store));
    expect(res.applied).toBe(2);
    expect(photoCount(t)).toBe(2);
    expect(res.integrity?.ok).toBe(true);
  });

  it("is single-flight: concurrent calls share one in-flight run", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1")];
    const source = new FakeSource(store);
    const p1 = syncAll(t.db, source);
    const p2 = syncAll(t.db, source);
    expect(p1).toBe(p2); // same promise — no second run started
    await Promise.all([p1, p2]);
    // Photo feed fetched exactly the seed page + the empty tail once (one run).
    expect(source.calls.photo).toBe(2);
  });

  it("reseeds when favorite_min_rating changes", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1", { rating: 4 })];
    const source = new FakeSource(store);

    // First run stores the current threshold; no reseed.
    const r1 = await syncAll(t.db, source, { getFavoriteMinRating: async () => 3 });
    expect(r1.reseeded).toBe(false);
    expect(getMetaNumber(t.db, META_FAVORITE_MIN_RATING)).toBe(3);

    // Threshold changes → reseed.
    const r2 = await syncAll(t.db, source, { getFavoriteMinRating: async () => 5 });
    expect(r2.reseeded).toBe(true);
    expect(getMetaNumber(t.db, META_FAVORITE_MIN_RATING)).toBe(5);
    expect(recentSyncLog(t.db).some((l) => l.op === "reseed")).toBe(true);
  });

  it("detects integrity drift and re-seeds the drifted entity in the same run", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1")];
    // Server claims 99 photos but the mirror only has 1 → drift.
    const source = new FakeSource(store, { counts: { photos: 99 } });
    const res = await syncAll(t.db, source);

    expect(res.integrity?.ok).toBe(false);
    expect(res.integrity?.drifts.some((d) => d.entity === "photo")).toBe(true);
    expect(recentSyncLog(t.db).some((l) => l.op === "integrity" && l.level === "error")).toBe(true);

    // Drift clears the cursor AND enqueues a fresh `remote_delta` for the
    // entity, so the repair happens now rather than "next time something runs".
    // Under the old sequential driver the reseed was merely *scheduled* and the
    // mirror stayed wrong until some later sync happened to fire — the same
    // "progress deferred indefinitely" failure the job queue exists to end.
    // 2 fetches for the initial seed + 2 for the drift-driven re-seed.
    expect(source.calls.photo).toBe(4);
    expect(getSyncState(t.db, "photo")?.status).toBe("done");
  });

  it("repairSync wipes the mirror and re-seeds", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1"), photoItem("p2")];
    const source = new FakeSource(store);
    await syncAll(t.db, source);
    expect(photoCount(t)).toBe(2);

    store.photo = [photoItem("p1")]; // server now has fewer
    const res = await repairSync(t.db, source);
    expect(res.reason).toBe("manual");
    expect(photoCount(t)).toBe(1);
  });
});

describe("foreground throttle", () => {
  it("blocks a second run inside the throttle window and allows it after", () => {
    const throttle = createThrottle(60_000);
    expect(throttle.tryRun(1_000)).toBe(true); // first run
    expect(throttle.tryRun(30_000)).toBe(false); // 29s later — throttled
    expect(throttle.tryRun(61_001)).toBe(true); // >60s after first — allowed
  });
});
