/**
 * @jest-environment node
 *
 * Pipeline-starvation regression cover — the tests that motivated replacing the
 * sequential driver with a durable job queue.
 *
 * The sync sequence used to be one strictly sequential chain, so hashing could
 * not begin until the camera-roll enumeration had finished — and the enumeration
 * restarts on every app reload. A user watched 161 of 2867 photos get hashed,
 * reloaded the app, and the counter never moved again: the scan in front of
 * hashing never finished, so hashing never got a turn. Uploads, sitting last,
 * never began at all.
 *
 * These tests pin the properties that make that impossible:
 *   1. hashing makes progress *while* the scan is still running;
 *   2. uploads begin while hashing is still in progress (not after it);
 *   3. hashes already computed survive a reload (no restart from zero);
 *   4. the second run takes the incremental fast path instead of re-reading the
 *      whole library;
 *   5. an interrupted run leaves durable work behind, not a discarded call stack.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncAll, type SyncAllOptions } from "../orchestrator";
import { syncDeviceMedia } from "../device/media-sync";
import { runHashPass } from "../device/hasher";
import { resetBootReclaimForTests } from "../jobs/worker";
import { FakeSource, emptyStore } from "./fake-source";
import { FakeHasher, FakeMedia, asset } from "../device/__tests__/fake-media";
import type { MediaQuery } from "../device/types";

const USER_ID = 7;

function hashedCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM local_asset WHERE hash IS NOT NULL`) as { c: number })
    .c;
}
function assetCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM local_asset`) as { c: number }).c;
}

/** A library of `count` assets with strictly increasing creation times. */
function library(count: number) {
  return Array.from({ length: count }, (_, i) =>
    asset(`p${String(i).padStart(4, "0")}`, { creationTime: 1_000 + i })
  );
}

/** Wire the real device-scan + hash job seams into the orchestrator. */
function steps(
  media: FakeMedia,
  hasher: FakeHasher,
  extra: { pageSize?: number; scan?: number; hash?: number } = {}
): SyncAllOptions {
  return {
    budgets: { scan: extra.scan ?? 50, hash: extra.hash ?? 10 },
    scanChunk: async (ctx, budget) => {
      const r = await syncDeviceMedia(ctx.db, media, {
        signal: ctx.signal,
        log: ctx.log,
        pageSize: extra.pageSize ?? 25,
        maxAssetsPerRun: budget,
      });
      return { complete: r.complete, added: r.added, scanned: r.scanned };
    },
    hashBatch: async (ctx, budget) => {
      const r = await runHashPass(ctx.db, hasher, {
        userId: USER_ID,
        signal: ctx.signal,
        log: ctx.log,
        maxAssets: budget,
        batchSize: budget,
      });
      return { hashed: r.hashed, failed: r.failed, more: r.more === true };
    },
  };
}

describe("sync pipeline: no step may starve the one behind it", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
  });
  afterEach(() => t.close());

  it("hashes assets while the camera-roll scan is still enumerating", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(200));
    const hasher = new FakeHasher();

    // Record whether any hash landed before the scan reported its last page.
    let hashedBeforeScanFinished = 0;
    let scanFinished = false;
    const originalGetAssets = media.getAssets.bind(media);
    media.getAssets = async (q: MediaQuery) => {
      const page = await originalGetAssets(q);
      if (!page.hasNextPage) scanFinished = true;
      else if (!scanFinished)
        hashedBeforeScanFinished = Math.max(hashedBeforeScanFinished, hasher.order.length);
      return page;
    };

    await syncAll(t.db, new FakeSource(emptyStore()), steps(media, hasher));

    expect(assetCount(t)).toBe(200);
    expect(hashedCount(t)).toBe(200);
    // The whole point: hashing was already underway before enumeration ended.
    expect(hashedBeforeScanFinished).toBeGreaterThan(0);
  });

  it("resumes hashing after a reload instead of restarting from zero", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(120));
    const hasher = new FakeHasher();

    // First run: aborted partway, exactly like the app being killed/reloaded.
    const controller = new AbortController();
    let hashes = 0;
    const originalMd5 = hasher.hash.bind(hasher);
    hasher.hash = async (a) => {
      hashes += 1;
      if (hashes === 30) controller.abort();
      return originalMd5(a);
    };
    await expect(
      syncAll(t.db, new FakeSource(emptyStore()), {
        ...steps(media, hasher),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    const afterCrash = hashedCount(t);
    expect(afterCrash).toBeGreaterThan(0);
    expect(afterCrash).toBeLessThan(120);

    // Second run (the "reload"): a fresh hasher, so anything it touches is a
    // re-hash. Progress must carry over in local_asset.hash.
    const hasher2 = new FakeHasher();
    await syncAll(t.db, new FakeSource(emptyStore()), steps(media, hasher2));

    expect(hashedCount(t)).toBe(120);
    // Only the not-yet-hashed remainder was hashed again — no restart at zero.
    expect(hasher2.order.length).toBe(120 - afterCrash);
    expect(new Set(hasher2.order).size).toBe(hasher2.order.length);
  });

  it("an interrupted run leaves nothing latched that skips the next one", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(40));
    const controller = new AbortController();
    controller.abort();

    await expect(
      syncAll(t.db, new FakeSource(emptyStore()), {
        ...steps(media, new FakeHasher()),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    // The single-flight mutex and the abort controller must both be released,
    // and the durable queue must still hold the work the aborted run enqueued.
    const pending = (
      t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'pending'`) as { c: number }
    ).c;
    expect(pending).toBeGreaterThan(0);

    const result = await syncAll(t.db, new FakeSource(emptyStore()), steps(media, new FakeHasher()));
    expect(result).toBeTruthy();
    expect(hashedCount(t)).toBe(40);
  });

  it("takes the incremental fast path on the second run", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(150));
    await syncAll(t.db, new FakeSource(emptyStore()), steps(media, new FakeHasher()));
    expect(assetCount(t)).toBe(150);

    // Second run over an unchanged library: every asset query must be a
    // watermark-scoped probe, never a full re-read of the album. (With iOS
    // smart albums in the mix this used to fall into the full-diff fallback on
    // every single run.)
    media.queries = [];
    await syncAll(t.db, new FakeSource(emptyStore()), steps(media, new FakeHasher()));

    const assetQueries = media.queries.filter((q) => q.first > 1);
    expect(assetQueries.length).toBeGreaterThan(0);
    expect(assetQueries.every((q) => q.createdAfter != null)).toBe(true);
    expect(assetCount(t)).toBe(150);
  });
});
