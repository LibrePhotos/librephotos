/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import {
  createTestDb,
  insertLocalAlbum,
  insertLocalAsset,
  remotePhoto,
  seedRemotePhotos,
  type TestDb,
} from "@librephotos/local-db/testing";
import { enqueueBackups, nextEligible, markFailed, queueSummary, MAX_ATTEMPTS } from "@librephotos/local-db";
import { enqueueUploadWindow } from "@/sync/jobs/handlers";

async function queuedIds(t: TestDb): Promise<string[]> {
  return (await t.db.all<{ asset_id: string }>(sql`SELECT asset_id FROM upload_queue ORDER BY asset_id`)).map(
    (r) => r.asset_id
  );
}

describe("upload queue enqueue rule", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("enqueues only hashed, selected, non-excluded assets with no remote match", async () => {
    // selected + hashed + not on server → enqueue
    await insertLocalAsset(t.db, { id: "yes", hash: "h_yes" });
    // selected but NOT hashed → skip
    await insertLocalAsset(t.db, { id: "unhashed", hash: null });
    // hashed but album is excluded → skip
    await insertLocalAsset(t.db, { id: "excluded", hash: "h_excl" });
    // hashed + selected but already on the server (hash matches remote) → skip
    await insertLocalAsset(t.db, { id: "onserver", hash: "h_srv" });
    // hashed but in no backup-selected album → skip
    await insertLocalAsset(t.db, { id: "loose", hash: "h_loose" });

    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["yes", "unhashed", "onserver"] });
    await insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["excluded"] });
    await insertLocalAlbum(t.db, { id: "misc", backupSelection: 0, assetIds: ["loose"] });
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "h_srv" })]);

    const n = await enqueueBackups(t.db, 1_000);
    expect(n).toBe(1);
    expect(await queuedIds(t)).toEqual(["yes"]);
  });

  it("does not double-enqueue an already-queued asset", async () => {
    await insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    expect(await enqueueBackups(t.db)).toBe(1);
    expect(await enqueueBackups(t.db)).toBe(0);
  });

  it("excludes an asset that is in BOTH a selected and an excluded album", async () => {
    await insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    await insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["a1"] });
    expect(await enqueueBackups(t.db)).toBe(0);
  });

  it("nextEligible respects backoff windows and the attempt cap", async () => {
    await insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    await enqueueBackups(t.db);

    // Fail once → parked with a future backoff window.
    await markFailed(t.db, "a1", "boom", 1_000, 100);
    expect(await nextEligible(t.db, 1_050)).toBeNull();
    expect((await nextEligible(t.db, 10_000))?.asset_id).toBe("a1");

    // Exhaust attempts → permanently parked.
    for (let i = 0; i < MAX_ATTEMPTS; i++) (await markFailed(t.db, "a1", "boom", 1_000, 1));
    expect(await nextEligible(t.db, 10_000_000)).toBeNull();
    expect((await queueSummary(t.db)).failed).toBe(1);
  });
  /* -- iCloud-parked assets are still the user's photos ------------------ */

  it("enqueues a selected iCloud-only asset even though it has no hash", async () => {
    // Refusing these would silently drop most of the library on any iPhone
    // using "Optimise iPhone Storage" — the exact configuration this whole
    // change exists for. The worker fetches and hashes them on the way out.
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    // …but an asset with no hash and no reason recorded is not ready for
    // anything: it has simply not been looked at yet.
    await insertLocalAsset(t.db, { id: "untouched", hash: null });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud", "untouched"] });

    expect(await enqueueBackups(t.db, 1_000)).toBe(1);
    expect(await queuedIds(t)).toEqual(["cloud"]);
  });

  it("opens the upload window on local assets before iCloud ones", async () => {
    // The iCloud asset is enqueued FIRST, so FIFO alone would put it in front
    // and park the serial queue on a download while ready photos waited.
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    await enqueueBackups(t.db, 1_000);
    await insertLocalAsset(t.db, { id: "local", hash: "h-local" });
    await t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', 'local')`);
    await enqueueBackups(t.db, 2_000);

    const window = await enqueueUploadWindow(t.db, 3_000);
    expect(window.map((j) => j.payload?.assetId)).toEqual(["local", "cloud"]);
  });
});
