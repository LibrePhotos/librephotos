/**
 * @jest-environment node
 *
 * The timeline's half of #2740: a camera-roll row whose upload is done but whose
 * server photo is not in the mirror with a thumbnail is flagged, so its tile
 * shows an hourglass instead of the "only on this phone" badge.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../testing";
import { timelinePage } from "../queries/timeline";
import { settleUploads } from "../queries/upload-processing";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "../fixtures";

async function queue(t: TestDb, assetId: string, state: string, serverPhotoId: string | null = null): Promise<void> {
  await t.db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at, server_photo_id)
        VALUES (${assetId}, ${state}, 1, 0, 1, ${serverPhotoId})`
  );
}

async function processingByLocalId(t: TestDb): Promise<Record<string, number>> {
  return Object.fromEntries(
    (await timelinePage(t.db, { limit: 50 })).rows.filter((r) => r.local_id !== null && r.remote_id === null)
      .map((r): [string, number] => [r.local_id ?? "", r.processing])
  );
}

describe("processing on the server, in the timeline", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    for (const id of ["up", "local", "failed"]) (await insertLocalAsset(t.db, { id, hash: `h-${id}` }));
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["up", "local", "failed"] });
    await queue(t, "up", "done", "p-up");
    await queue(t, "failed", "failed");
  });
  afterEach(() => t.close());

  it("flags only the uploaded camera-roll row", async () => {
    expect(await processingByLocalId(t)).toEqual({ up: 1, local: 0, failed: 0 });
  });

  it("keeps the flag while the mirrored photo has no thumbnail or date", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", aspectRatio: null, timestamp: null })]);
    expect((await processingByLocalId(t)).up).toBe(1);
  });

  it("drops the flag once the photo is in the mirror with a thumbnail", async () => {
    // Still undated, so the camera-roll row is what the timeline shows.
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", timestamp: null })]);
    expect((await processingByLocalId(t)).up).toBe(0);
  });

  it("never flags a server row", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", aspectRatio: null })]);
    const row = (await timelinePage(t.db, { limit: 50 })).rows.find((r) => r.remote_id === "p-up");
    expect(row?.processing).toBe(0);
  });

  it("settles a ready upload once, and leaves the rest", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up" })]);
    await queue(t, "local", "skipped_exists");
    await settleUploads(t.db, 42);
    const rows = await t.db.all(sql`SELECT asset_id, server_ready_at FROM upload_queue ORDER BY asset_id`);
    expect(rows).toEqual([
      { asset_id: "failed", server_ready_at: null },
      { asset_id: "local", server_ready_at: null },
      { asset_id: "up", server_ready_at: 42 },
    ]);
    await settleUploads(t.db, 99);
    expect(await t.db.get(sql`SELECT server_ready_at AS at FROM upload_queue WHERE asset_id = 'up'`)).toEqual({ at: 42 });
  });
});
