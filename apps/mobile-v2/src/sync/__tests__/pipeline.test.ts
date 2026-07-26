/**
 * @jest-environment node
 *
 * Pipeline-starvation regression cover.
 *
 * The sync sequence used to be one strictly sequential chain, so hashing could
 * not begin until the camera-roll enumeration had finished — and the
 * enumeration restarts on every app reload. A user watched 161 of 2867 photos
 * get hashed, reloaded the app, and the counter never moved again: the scan in
 * front of hashing never finished, so hashing never got a turn.
 *
 * These tests pin the three properties that make that impossible:
 *   1. hashing makes progress *while* the scan is still running;
 *   2. hashes already computed survive a reload (no restart from zero);
 *   3. the second run takes the incremental fast path instead of re-reading
 *      the whole library.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncAll, type SyncAllOptions } from "../orchestrator";
import { syncDeviceMedia } from "../device/media-sync";
import { runHashPass } from "../device/hasher";
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

/** Wire the real device-sync + hash steps into the orchestrator. */
function steps(
  t: TestDb,
  media: FakeMedia,
  hasher: FakeHasher,
  extra: { pageSize?: number; scanDelayMs?: number } = {}
): SyncAllOptions {
  return {
    syncDeviceMedia: async ({ db, signal, log, moreExpected }) => {
      void moreExpected;
      await syncDeviceMedia(db, media, {
        signal,
        log,
        pageSize: extra.pageSize ?? 25,
      });
    },
    hashAssets: async ({ db, signal, log, moreExpected }) => {
      await runHashPass(db, hasher, {
        userId: USER_ID,
        signal,
        log,
        batchSize: 10,
        keepGoing: moreExpected,
        idleDelayMs: 1,
      });
    },
  };
}

describe("sync pipeline: no step may starve the one behind it", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
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
      else if (!scanFinished) hashedBeforeScanFinished = Math.max(hashedBeforeScanFinished, hasher.order.length);
      return page;
    };

    await syncAll(t.db, new FakeSource(emptyStore()), steps(t, media, hasher));

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
    const originalMd5 = hasher.md5.bind(hasher);
    hasher.md5 = async (a) => {
      hashes += 1;
      if (hashes === 30) controller.abort();
      return originalMd5(a);
    };
    await expect(
      syncAll(t.db, new FakeSource(emptyStore()), {
        ...steps(t, media, hasher),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    const afterCrash = hashedCount(t);
    expect(afterCrash).toBeGreaterThan(0);
    expect(afterCrash).toBeLessThan(120);

    // Second run (the "reload"): a fresh hasher, so anything it touches is a
    // re-hash. Progress must carry over in local_asset.hash.
    const hasher2 = new FakeHasher();
    await syncAll(t.db, new FakeSource(emptyStore()), steps(t, media, hasher2));

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
        ...steps(t, media, new FakeHasher()),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    // The single-flight mutex and the abort controller must both be released.
    const result = await syncAll(t.db, new FakeSource(emptyStore()), steps(t, media, new FakeHasher()));
    expect(result).toBeTruthy();
    expect(hashedCount(t)).toBe(40);
  });

  it("takes the incremental fast path on the second run", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(150));
    await syncAll(t.db, new FakeSource(emptyStore()), steps(t, media, new FakeHasher()));
    expect(assetCount(t)).toBe(150);

    // Second run over an unchanged library: every asset query must be a
    // watermark-scoped probe, never a full re-read of the album. (With iOS
    // smart albums in the mix this used to fall into the full-diff fallback on
    // every single run.)
    media.queries = [];
    await syncAll(t.db, new FakeSource(emptyStore()), steps(t, media, new FakeHasher()));

    const assetQueries = media.queries.filter((q) => q.first > 1);
    expect(assetQueries.length).toBeGreaterThan(0);
    expect(assetQueries.every((q) => q.createdAfter != null)).toBe(true);
    expect(assetCount(t)).toBe(150);
  });
});
