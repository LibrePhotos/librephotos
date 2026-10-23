/**
 * @jest-environment node
 *
 * The Backup screen must always be able to explain itself. On the device run a
 * user selected an album, saw nothing upload, and had no way to tell a broken
 * queue from a switched-off one. Every state below is one answer that screen
 * has to be able to give.
 */
import { sql } from "drizzle-orm";
import type { SyncPhotosResponse } from "@librephotos/api-client";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { getBackupConfig, setBackupConfig } from "@/db/queries/backup";
import { photoItem } from "@/sync/__tests__/fake-source";
import { applyPhotosPage } from "@/sync/remote/applier";
import { backupState } from "../status";
import { markDone, queueList } from "../queue";

/** `count` selected assets, the first `hashedCount` of them already hashed. */
function seedSelected(t: TestDb, count: number, hashedCount: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `a${i}`;
    ids.push(id);
    insertLocalAsset(t.db, { id, hash: i < hashedCount ? `h${i}` : null });
  }
  insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ids });
  return ids;
}

function stateOf(
  t: TestDb,
  opts: { access?: "all" | "limited" | "none" | null; gate?: { allowed: true } | { allowed: false; reason: string } | null } = {}
) {
  return backupState(t.db, {
    config: getBackupConfig(t.db),
    access: opts.access === undefined ? "all" : opts.access,
    gate: opts.gate ?? null,
  });
}

describe("backupState", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setBackupConfig(t.db, { enabled: true });
  });
  afterEach(() => t.close());

  it("blocks on missing photo permission before anything else", () => {
    seedSelected(t, 3, 3);
    expect(stateOf(t, { access: null }).blocker).toEqual({ kind: "no_access" });
    expect(stateOf(t, { access: "none" }).blocker).toEqual({ kind: "no_access" });
  });

  it("names the master toggle when backup is off", () => {
    seedSelected(t, 3, 3);
    setBackupConfig(t.db, { enabled: false });
    expect(stateOf(t).blocker).toEqual({ kind: "disabled" });
  });

  it("asks for an album when nothing is selected", () => {
    insertLocalAsset(t.db, { id: "a0", hash: "h0" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 0, assetIds: ["a0"] });
    const state = stateOf(t);
    expect(state.blocker).toEqual({ kind: "no_selection" });
    expect(state.stage).toEqual({ kind: "idle" });
  });

  it("reports hashing against the real total, not the growing hashed count", () => {
    // The exact shape the user hit: a 2867-photo album, 161 hashed so far.
    // The old UI showed "0/161"; the total must be 2867.
    seedSelected(t, 2867, 161);
    const state = stateOf(t);
    expect(state.stage).toEqual({ kind: "hashing", done: 161, total: 2867 });
    expect(state.counts.awaitingHash).toBe(2706);
    expect(state.blocker).toBeNull();
  });

  it("keeps the hash and upload stages separate", () => {
    seedSelected(t, 100, 40);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'done', 1, 0, 1), ('a2', 'pending', 0, 0, 1)`
    );
    const state = stateOf(t);
    // Headline is the blocking stage…
    expect(state.stage).toEqual({ kind: "hashing", done: 40, total: 100 });
    // …but the upload numbers are still available, against their own total.
    expect(state.queue.done).toBe(2);
    expect(state.queue.pending).toBe(1);
    expect(state.counts.hashed).toBe(40);
  });

  it("surfaces the wifi-only gate while work is waiting on it", () => {
    seedSelected(t, 2, 2);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1)`
    );
    const state = stateOf(t, { gate: { allowed: false, reason: "wifi_required" } });
    expect(state.blocker).toEqual({ kind: "wifi_required" });
    expect(state.stage).toEqual({ kind: "waiting", pending: 1 });
  });

  it("surfaces charging-only and offline gates too", () => {
    seedSelected(t, 2, 2);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1)`
    );
    expect(stateOf(t, { gate: { allowed: false, reason: "charging_required" } }).blocker).toEqual({
      kind: "charging_required",
    });
    expect(stateOf(t, { gate: { allowed: false, reason: "offline" } }).blocker).toEqual({
      kind: "offline",
    });
  });

  it("does not blame the gate when there is nothing left to upload", () => {
    seedSelected(t, 2, 2);
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "r0", imageHash: "h0" }),
      remotePhoto({ id: "r1", imageHash: "h1" }),
    ]);
    const state = stateOf(t, { gate: { allowed: false, reason: "wifi_required" } });
    expect(state.blocker).toBeNull();
    expect(state.stage).toEqual({ kind: "up_to_date", total: 2 });
  });

  it("reports uploads in flight with their own total", () => {
    seedSelected(t, 3, 3);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'uploading', 0.4, 0, 1), ('a2', 'pending', 0, 0, 1)`
    );
    expect(stateOf(t).stage).toEqual({ kind: "uploading", done: 1, total: 3, inFlight: 1 });
  });

  it("reports failures once nothing else is blocking", () => {
    seedSelected(t, 2, 2);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'failed', 0, 2, 1), ('a1', 'done', 1, 0, 1)`
    );
    const state = stateOf(t);
    expect(state.blocker).toEqual({ kind: "failed", count: 1 });
  });

  it("says it is up to date when everything selected is on the server", () => {
    seedSelected(t, 2, 2);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'skipped_exists', 1, 0, 1)`
    );
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "r0", imageHash: "h0" }),
      remotePhoto({ id: "r1", imageHash: "h1" }),
    ]);
    const state = stateOf(t);
    expect(state.blocker).toBeNull();
    // Each photo once: the queue row and the mirror row are the same photo.
    expect(state.stage).toEqual({ kind: "up_to_date", total: 2 });
  });

  /* -- #2740: uploaded, but the server is still processing ---------------- */

  describe("processing on the server", () => {
    /** Mark `ids` uploaded, as the worker does after `/api/upload/complete/`. */
    function uploaded(ids: string[]): void {
      for (const id of ids) {
        t.db.run(
          sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
              VALUES (${id}, 'uploading', 1, 0, 1)`
        );
        markDone(t.db, id, `photo-${id}`);
      }
    }

    /** One delta page, as the sync loop applies it. */
    function deltaPage(items: SyncPhotosResponse["items"], tombstones: string[] = []): void {
      applyPhotosPage(t.db, { v: 1, items, tombstones, next_cursor: null, server_time: "0" }, 5000);
    }

    it("counts an upload the mirror does not have yet as processing, not as missing", () => {
      seedSelected(t, 2, 2);
      uploaded(["a0", "a1"]);
      const state = stateOf(t);
      expect(state.counts).toMatchObject({ onServer: 2, processingOnServer: 2 });
      // Never "up to date" while the server still works on them.
      expect(state.stage).toEqual({ kind: "processing", uploaded: 2, processing: 2 });
      expect(state.blocker).toBeNull();
    });

    it("counts a mirrored photo without a thumbnail as processing", () => {
      seedSelected(t, 1, 1);
      uploaded(["a0"]);
      deltaPage([photoItem("photo-a0", { image_hash: "h0", aspect_ratio: null, timestamp: null })]);
      expect(stateOf(t).counts.processingOnServer).toBe(1);
    });

    it("drops to zero once a delta sync brings the photos in with thumbnails", () => {
      seedSelected(t, 3, 3);
      seedRemotePhotos(t.db, [remotePhoto({ id: "r2", imageHash: "h2" })]); // backed up long ago
      uploaded(["a0", "a1"]);
      expect(stateOf(t).stage).toEqual({ kind: "processing", uploaded: 3, processing: 2 });

      deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      expect(stateOf(t).stage).toEqual({ kind: "processing", uploaded: 3, processing: 1 });

      deltaPage([photoItem("photo-a1", { image_hash: "h1" })]);
      const state = stateOf(t);
      expect(state.counts.processingOnServer).toBe(0);
      expect(state.stage).toEqual({ kind: "up_to_date", total: 3 });
    });

    it("follows the photo id the completion answered when the hash went stale", () => {
      // The bytes changed between the hash pass and the upload (an iOS edit):
      // the server photo's hash is not the one stored on the asset.
      seedSelected(t, 1, 1);
      uploaded(["a0"]);
      deltaPage([photoItem("photo-a0", { image_hash: "edited-bytes" })]);
      expect(stateOf(t).counts.processingOnServer).toBe(0);
    });

    it("matches a duplicate the server already had by its hash", () => {
      seedSelected(t, 1, 1);
      t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a0', 'skipped_exists', 1, 0, 1)`
      );
      expect(stateOf(t).counts.processingOnServer).toBe(1);
      deltaPage([photoItem("older-photo", { image_hash: "h0" })]);
      expect(stateOf(t).counts.processingOnServer).toBe(0);
    });

    it("does not count a photo deleted on the server after it was ready", () => {
      seedSelected(t, 1, 1);
      uploaded(["a0"]);
      deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      deltaPage([], ["photo-a0"]);
      const state = stateOf(t);
      expect(state.counts.processingOnServer).toBe(0);
      expect(state.stage.kind).not.toBe("processing");
    });

    it("keeps the running stage as the headline and counts processing alongside", () => {
      seedSelected(t, 2, 2);
      uploaded(["a0"]);
      t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a1', 'uploading', 0.5, 0, 1)`
      );
      const state = stateOf(t);
      expect(state.stage).toEqual({ kind: "uploading", done: 1, total: 2, inFlight: 1 });
      expect(state.counts.processingOnServer).toBe(1);
    });

    it("labels the queue row until the photo is ready", () => {
      seedSelected(t, 2, 2);
      uploaded(["a0"]);
      t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a1', 'pending', 0, 0, 1)`
      );
      const processing = () => Object.fromEntries(queueList(t.db).map((r): [string, number] => [r.asset_id, r.processing]));
      expect(processing()).toEqual({ a0: 1, a1: 0 });
      deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      expect(processing()).toEqual({ a0: 0, a1: 0 });
    });
  });
  /* -- iCloud: photos that are not on the phone at all ------------------- */

  it("counts iCloud-parked assets separately from ones awaiting the hasher", () => {
    seedSelected(t, 1, 0); // a0: selected, un-hashed, readable
    insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', 'cloud')`);

    const counts = stateOf(t).counts;
    // Folding these together is what would produce a hash bar that never
    // reaches its total on a phone using "Optimise iPhone Storage".
    expect(counts).toMatchObject({ selected: 2, awaitingHash: 1, awaitingRemote: 1 });
  });

  it("names the iCloud wait rather than claiming to be up to date", () => {
    insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    setBackupConfig(t.db, { enabled: true });

    const state = stateOf(t);
    expect(state.stage).toEqual({ kind: "icloud", pending: 1 });
    expect(state.blocker).toBeNull(); // waiting on a download is not a fault
  });

  it("does not call a queue of iCloud-only assets 'ready to upload'", () => {
    insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('cloud', 'pending', 0, 0, 1)`
    );
    expect(stateOf(t).stage).toEqual({ kind: "icloud", pending: 1 });
  });

  it("still reports locally-ready uploads while iCloud assets queue behind them", () => {
    seedSelected(t, 1, 1); // a0 is hashed and ready
    insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', 'cloud')`);
    t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1), ('cloud', 'pending', 0, 0, 2)`
    );
    expect(stateOf(t).stage).toEqual({ kind: "waiting", pending: 1 });
  });
});
