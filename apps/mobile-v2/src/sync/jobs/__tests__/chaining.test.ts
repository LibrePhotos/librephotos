/**
 * @jest-environment node
 *
 * **The regression that motivated the whole rewrite.**
 *
 * On a real 2867-photo library the old sequential driver produced, on-device:
 *   - hashing stalled behind a full camera-roll enumeration, and a reload
 *     restarted the whole chain, so hashing never resumed;
 *   - uploads never began, because they sat last behind the slowest steps;
 *   - no durable record of progress — the only state was the call stack.
 *
 * These tests drive the real handlers over the real camera-roll scan, hash pass
 * and upload queue (fake provider / hasher / transport, real SQLite) and assert
 * the three properties that make that impossible:
 *
 *   1. a `hash_batch` chains `upload_asset` jobs, so uploads start *during*
 *      hashing rather than after it;
 *   2. interrupting mid-run and restarting resumes hashing from
 *      `local_asset.hash` instead of re-hashing from zero;
 *   3. a scan chunk chains both its own continuation and a hash batch, so the
 *      enumeration can never hold hashing hostage.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { setBackupConfig } from "@/db/queries/backup";
import { syncBackupOnly, type SyncAllOptions } from "@/sync/orchestrator";
import { syncDeviceMedia, LIBRARY_ALBUM_ID } from "@/sync/device/media-sync";
import { runHashPass } from "@/sync/device/hasher";
import { enqueueBackups } from "@/sync/upload/queue";
import { runUploadItem } from "@/sync/upload/worker";
import { FakeSource, emptyStore } from "@/sync/__tests__/fake-source";
import { FakeHasher, FakeMedia, asset } from "@/sync/device/__tests__/fake-media";
import { resetBootReclaimForTests } from "../worker";
import type { UploadCompleteInput, UploadFileInput, UploadTransport } from "@/sync/upload/transport";

const USER_ID = 7;

/**
 * The user tapping "All Photos" on the Backup screen: mark the synthetic
 * whole-library album selected *before* the scan runs. `upsertLocalAlbum`
 * preserves `backup_selection` across the scan's upsert, so the choice survives.
 */
function selectLibraryForBackup(t: TestDb): void {
  t.db.run(
    sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
        VALUES (${LIBRARY_ALBUM_ID}, 'All Photos', 0, 0, 1)`
  );
}

class FakeTransport implements UploadTransport {
  existsSet = new Set<string>();
  uploads: UploadFileInput[] = [];
  completes: UploadCompleteInput[] = [];
  async exists(hash: string) {
    return this.existsSet.has(hash);
  }
  async uploadFile(input: UploadFileInput) {
    this.uploads.push(input);
    return { uploadId: `up-${input.assetId}` };
  }
  async complete(input: UploadCompleteInput) {
    this.completes.push(input);
  }
}

function library(count: number) {
  return Array.from({ length: count }, (_, i) =>
    asset(`p${String(i).padStart(4, "0")}`, { creationTime: 1_000 + i })
  );
}
function hashedCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM local_asset WHERE hash IS NOT NULL`) as { c: number })
    .c;
}
function uploadedCount(t: TestDb): number {
  return (
    t.db.get(sql`SELECT COUNT(*) AS c FROM upload_queue WHERE state = 'done'`) as { c: number }
  ).c;
}

/**
 * Wire the real scan / hash / upload bodies into the job seams — the same
 * mapping `sync/run.ts` does for the app, minus the expo singletons.
 */
function seams(
  media: FakeMedia,
  hasher: FakeHasher,
  transport: FakeTransport,
  hooks: {
    onHash?: (total: number) => void;
    onUpload?: (assetId: string) => void;
    scan?: number;
    hash?: number;
  } = {}
): SyncAllOptions {
  return {
    budgets: { scan: hooks.scan ?? 40, hash: hooks.hash ?? 10, uploadWindow: 2 },
    backupEnabled: () => true,
    scanChunk: async (ctx, budget) => {
      const r = await syncDeviceMedia(ctx.db, media, {
        signal: ctx.signal,
        log: ctx.log,
        pageSize: 20,
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
      enqueueBackups(ctx.db);
      hooks.onHash?.(hasher.order.length);
      return { hashed: r.hashed, failed: r.failed, more: r.more === true };
    },
    uploadAsset: async (ctx, assetId) => {
      hooks.onUpload?.(assetId);
      const r = await runUploadItem(ctx.db, assetId, {
        userId: USER_ID,
        transport,
        signal: ctx.signal,
        log: ctx.log,
      });
      return { uploaded: r.uploaded, skipped: r.skipped, gated: r.gated };
    },
  };
}

describe("job chaining: uploads start while hashing is still running", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
    setBackupConfig(t.db, { enabled: true });
    selectLibraryForBackup(t);
  });
  afterEach(() => t.close());

  it("hashes, enqueues and uploads a whole library end to end", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(60));
    const transport = new FakeTransport();

    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      seams(media, new FakeHasher(), transport)
    );

    expect(hashedCount(t)).toBe(60);
    expect(uploadedCount(t)).toBe(60);
    expect(transport.completes).toHaveLength(60);
  });

  it("begins uploading before hashing has finished", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(60));
    const transport = new FakeTransport();

    // The assertion the maintainer actually cares about: at the moment the FIRST
    // upload runs, hashing must still have work outstanding. Under the old
    // chain uploads were the last link, so this was 60/60 — uploads only ever
    // started once every byte of the library had been read.
    let hashedAtFirstUpload = -1;
    let unhashedAtFirstUpload = -1;
    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      seams(media, new FakeHasher(), transport, {
        onUpload: () => {
          if (hashedAtFirstUpload !== -1) return;
          hashedAtFirstUpload = hashedCount(t);
          unhashedAtFirstUpload = (
            t.db.get(
              sql`SELECT COUNT(*) AS c FROM local_asset WHERE hash IS NULL AND hashed_at IS NULL`
            ) as { c: number }
          ).c;
        },
      })
    );

    expect(hashedAtFirstUpload).toBeGreaterThan(0); // some hashing had happened…
    expect(hashedAtFirstUpload).toBeLessThan(60); // …but not all of it.
    expect(unhashedAtFirstUpload).toBeGreaterThan(0); // work was still outstanding
    expect(uploadedCount(t)).toBe(60);
  });

  it("interleaves scanning, hashing and uploading instead of running them in phases", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(80));
    const transport = new FakeTransport();
    const timeline: ("hash" | "upload")[] = [];

    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      seams(media, new FakeHasher(), transport, {
        onHash: () => timeline.push("hash"),
        onUpload: () => timeline.push("upload"),
      })
    );

    // A phased run looks like hhhh…uuuu; an interleaved one alternates. Assert
    // there is at least one hash *after* the first upload — i.e. hashing was
    // genuinely still going when uploading started.
    const firstUpload = timeline.indexOf("upload");
    expect(firstUpload).toBeGreaterThanOrEqual(0);
    expect(timeline.slice(firstUpload).includes("hash")).toBe(true);
  });

  it("holds uploads back when backup is switched off, but still hashes", async () => {
    setBackupConfig(t.db, { enabled: false });
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(30));
    const transport = new FakeTransport();

    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      // backupEnabled false ⇒ hash_batch must not open an upload window.
      { ...seams(media, new FakeHasher(), transport), backupEnabled: () => false }
    );

    expect(hashedCount(t)).toBe(30);
    expect(transport.uploads).toHaveLength(0);
  });
});

describe("job chaining: interrupt and restart", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
    setBackupConfig(t.db, { enabled: true });
    selectLibraryForBackup(t);
  });
  afterEach(() => t.close());

  it("resumes hashing from local_asset.hash and keeps uploading after a restart", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(100));
    const transport = new FakeTransport();

    // ---- run 1: killed partway through, exactly like a JS reload -----------
    const controller = new AbortController();
    const hasher1 = new FakeHasher();
    const originalMd5 = hasher1.md5.bind(hasher1);
    let hashes = 0;
    hasher1.md5 = async (a) => {
      hashes += 1;
      if (hashes === 25) controller.abort();
      return originalMd5(a);
    };

    await expect(
      syncBackupOnly(t.db, new FakeSource(emptyStore()), {
        ...seams(media, hasher1, transport),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    const hashedAfterCrash = hashedCount(t);
    const uploadedAfterCrash = uploadedCount(t);
    expect(hashedAfterCrash).toBeGreaterThan(0);
    expect(hashedAfterCrash).toBeLessThan(100);
    // Uploads had already begun before the interruption — the old chain would
    // have had zero here, because uploading came last.
    expect(uploadedAfterCrash).toBeGreaterThan(0);

    // The interrupted work is durable, not discarded with the call stack.
    const liveJobs = (
      t.db.get(
        sql`SELECT COUNT(*) AS c FROM job_queue WHERE state IN ('pending', 'running')`
      ) as { c: number }
    ).c;
    expect(liveJobs).toBeGreaterThan(0);

    // ---- run 2: the "reload" ----------------------------------------------
    // A brand-new hasher, so anything it touches is provably a RE-hash. Also a
    // fresh boot-reclaim, so any row the killed run left `running` is recovered.
    resetBootReclaimForTests();
    const hasher2 = new FakeHasher();
    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      seams(media, hasher2, transport)
    );

    expect(hashedCount(t)).toBe(100);
    // The core claim: hashing picked up where it stopped. Only the remainder was
    // hashed again, and no asset twice.
    expect(hasher2.order.length).toBe(100 - hashedAfterCrash);
    expect(new Set(hasher2.order).size).toBe(hasher2.order.length);
    expect(uploadedCount(t)).toBe(100);
    // And no photo was uploaded twice across the two runs.
    expect(new Set(transport.uploads.map((u) => u.assetId)).size).toBe(transport.uploads.length);
  });

  it("recovers a job the killed process left mid-flight", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(20));
    const transport = new FakeTransport();

    const controller = new AbortController();
    const hasher = new FakeHasher();
    const originalMd5 = hasher.md5.bind(hasher);
    hasher.md5 = async (a) => {
      controller.abort(); // die inside the very first hash batch
      return originalMd5(a);
    };
    await expect(
      syncBackupOnly(t.db, new FakeSource(emptyStore()), {
        ...seams(media, hasher, transport),
        signal: controller.signal,
      })
    ).rejects.toThrow();

    // Nothing is stuck `running`: the worker released its claim on the way out.
    expect(
      (t.db.get(sql`SELECT COUNT(*) AS c FROM job_queue WHERE state = 'running'`) as { c: number }).c
    ).toBe(0);

    resetBootReclaimForTests();
    await syncBackupOnly(
      t.db,
      new FakeSource(emptyStore()),
      seams(media, new FakeHasher(), transport)
    );
    expect(hashedCount(t)).toBe(20);
    expect(uploadedCount(t)).toBe(20);
  });
});
