/**
 * @jest-environment node
 *
 * The timeline's half of #2740: a camera-roll row whose upload is done but whose
 * server photo is not in the mirror with a thumbnail is flagged, so its tile
 * shows an hourglass instead of the "only on this phone" badge.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import { timelinePage } from "../queries/timeline";
import { settleUploads } from "../queries/upload-processing";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "./fixtures";

function queue(t: TestDb, assetId: string, state: string, serverPhotoId: string | null = null): void {
  t.db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at, server_photo_id)
        VALUES (${assetId}, ${state}, 1, 0, 1, ${serverPhotoId})`
  );
}

function processingByLocalId(t: TestDb): Record<string, number> {
  return Object.fromEntries(
    timelinePage(t.db, { limit: 50 })
      .rows.filter((r) => r.local_id !== null && r.remote_id === null)
      .map((r): [string, number] => [r.local_id ?? "", r.processing])
  );
}

describe("processing on the server, in the timeline", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    for (const id of ["up", "local", "failed"]) insertLocalAsset(t.db, { id, hash: `h-${id}` });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["up", "local", "failed"] });
    queue(t, "up", "done", "p-up");
    queue(t, "failed", "failed");
  });
  afterEach(() => t.close());

  it("flags only the uploaded camera-roll row", () => {
    expect(processingByLocalId(t)).toEqual({ up: 1, local: 0, failed: 0 });
  });

  it("keeps the flag while the mirrored photo has no thumbnail or date", () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", aspectRatio: null, timestamp: null })]);
    expect(processingByLocalId(t).up).toBe(1);
  });

  it("drops the flag once the photo is in the mirror with a thumbnail", () => {
    // Still undated, so the camera-roll row is what the timeline shows.
    seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", timestamp: null })]);
    expect(processingByLocalId(t).up).toBe(0);
  });

  it("never flags a server row", () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up", aspectRatio: null })]);
    const row = timelinePage(t.db, { limit: 50 }).rows.find((r) => r.remote_id === "p-up");
    expect(row?.processing).toBe(0);
  });

  it("settles a ready upload once, and leaves the rest", () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "p-up", imageHash: "h-up" })]);
    queue(t, "local", "skipped_exists");
    settleUploads(t.db, 42);
    const rows = t.db.all(sql`SELECT asset_id, server_ready_at FROM upload_queue ORDER BY asset_id`);
    expect(rows).toEqual([
      { asset_id: "failed", server_ready_at: null },
      { asset_id: "local", server_ready_at: null },
      { asset_id: "up", server_ready_at: 42 },
    ]);
    settleUploads(t.db, 99);
    expect(t.db.get(sql`SELECT server_ready_at AS at FROM upload_queue WHERE asset_id = 'up'`)).toEqual({ at: 42 });
  });
});
