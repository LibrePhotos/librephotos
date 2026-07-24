/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, seedRemotePhotos, remotePhoto } from "@/db/__tests__/fixtures";
import { enqueueBackups, nextEligible, markFailed, queueSummary, MAX_ATTEMPTS } from "../queue";

function queuedIds(t: TestDb): string[] {
  return (t.db.all(sql`SELECT asset_id FROM upload_queue ORDER BY asset_id`) as { asset_id: string }[]).map(
    (r) => r.asset_id
  );
}

describe("upload queue enqueue rule", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("enqueues only hashed, selected, non-excluded assets with no remote match", () => {
    // selected + hashed + not on server → enqueue
    insertLocalAsset(t.db, { id: "yes", hash: "h_yes" });
    // selected but NOT hashed → skip
    insertLocalAsset(t.db, { id: "unhashed", hash: null });
    // hashed but album is excluded → skip
    insertLocalAsset(t.db, { id: "excluded", hash: "h_excl" });
    // hashed + selected but already on the server (hash matches remote) → skip
    insertLocalAsset(t.db, { id: "onserver", hash: "h_srv" });
    // hashed but in no backup-selected album → skip
    insertLocalAsset(t.db, { id: "loose", hash: "h_loose" });

    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["yes", "unhashed", "onserver"] });
    insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["excluded"] });
    insertLocalAlbum(t.db, { id: "misc", backupSelection: 0, assetIds: ["loose"] });
    seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "h_srv" })]);

    const n = enqueueBackups(t.db, 1_000);
    expect(n).toBe(1);
    expect(queuedIds(t)).toEqual(["yes"]);
  });

  it("does not double-enqueue an already-queued asset", () => {
    insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    expect(enqueueBackups(t.db)).toBe(1);
    expect(enqueueBackups(t.db)).toBe(0);
  });

  it("excludes an asset that is in BOTH a selected and an excluded album", () => {
    insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["a1"] });
    expect(enqueueBackups(t.db)).toBe(0);
  });

  it("nextEligible respects backoff windows and the attempt cap", () => {
    insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    enqueueBackups(t.db);

    // Fail once → parked with a future backoff window.
    markFailed(t.db, "a1", "boom", 1_000, 100);
    expect(nextEligible(t.db, 1_050)).toBeNull(); // still inside backoff
    expect(nextEligible(t.db, 10_000)?.asset_id).toBe("a1"); // past backoff

    // Exhaust attempts → permanently parked.
    for (let i = 0; i < MAX_ATTEMPTS; i++) markFailed(t.db, "a1", "boom", 1_000, 1);
    expect(nextEligible(t.db, 10_000_000)).toBeNull();
    expect(queueSummary(t.db).failed).toBe(1);
  });
});
