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
import {
  createTestDb,
  insertLocalAlbum,
  insertLocalAsset,
  remotePhoto,
  seedRemotePhotos,
  type TestDb,
} from "@librephotos/local-db/testing";
import { getBackupConfig, markDone, queueList, setBackupConfig } from "@librephotos/local-db";
import { photoItem } from "@/sync/__tests__/fake-source";
import { applyPhotosPage } from "@/sync/remote/applier";
import { backupState } from "../status";

/** `count` selected assets, the first `hashedCount` of them already hashed. */
async function seedSelected(t: TestDb, count: number, hashedCount: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `a${i}`;
    ids.push(id);
    await insertLocalAsset(t.db, { id, hash: i < hashedCount ? `h${i}` : null });
  }
  await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ids });
  return ids;
}

async function stateOf(
  t: TestDb,
  opts: { access?: "all" | "limited" | "none" | null; gate?: { allowed: true } | { allowed: false; reason: string } | null } = {}
) {
  return await backupState(t.db, {
    config: await getBackupConfig(t.db),
    access: opts.access === undefined ? "all" : opts.access,
    gate: opts.gate ?? null,
  });
}

describe("backupState", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await setBackupConfig(t.db, { enabled: true });
  });
  afterEach(() => t.close());

  it("blocks on missing photo permission before anything else", async () => {
    await seedSelected(t, 3, 3);
    expect((await stateOf(t, { access: null })).blocker).toEqual({ kind: "no_access" });
    expect((await stateOf(t, { access: "none" })).blocker).toEqual({ kind: "no_access" });
  });

  it("names the master toggle when backup is off", async () => {
    await seedSelected(t, 3, 3);
    await setBackupConfig(t.db, { enabled: false });
    expect((await stateOf(t)).blocker).toEqual({ kind: "disabled" });
  });

  it("asks for an album when nothing is selected", async () => {
    await insertLocalAsset(t.db, { id: "a0", hash: "h0" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 0, assetIds: ["a0"] });
    const state = await stateOf(t);
    expect(state.blocker).toEqual({ kind: "no_selection" });
    expect(state.stage).toEqual({ kind: "idle" });
  });

  it("reports hashing against the real total, not the growing hashed count", async () => {
    // The exact shape the user hit: a 2867-photo album, 161 hashed so far.
    // The old UI showed "0/161"; the total must be 2867.
    await seedSelected(t, 2867, 161);
    const state = await stateOf(t);
    expect(state.stage).toEqual({ kind: "hashing", done: 161, total: 2867 });
    expect(state.counts.awaitingHash).toBe(2706);
    expect(state.blocker).toBeNull();
  });

  it("keeps the hash and upload stages separate", async () => {
    await seedSelected(t, 100, 40);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'done', 1, 0, 1), ('a2', 'pending', 0, 0, 1)`
    );
    const state = await stateOf(t);
    // Headline is the blocking stage…
    expect(state.stage).toEqual({ kind: "hashing", done: 40, total: 100 });
    // …but the upload numbers are still available, against their own total.
    expect(state.queue.done).toBe(2);
    expect(state.queue.pending).toBe(1);
    expect(state.counts.hashed).toBe(40);
  });

  it("surfaces the wifi-only gate while work is waiting on it", async () => {
    await seedSelected(t, 2, 2);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1)`
    );
    const state = await stateOf(t, { gate: { allowed: false, reason: "wifi_required" } });
    expect(state.blocker).toEqual({ kind: "wifi_required" });
    expect(state.stage).toEqual({ kind: "waiting", pending: 1 });
  });

  it("surfaces charging-only and offline gates too", async () => {
    await seedSelected(t, 2, 2);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1)`
    );
    expect((await stateOf(t, { gate: { allowed: false, reason: "charging_required" } })).blocker).toEqual({
      kind: "charging_required",
    });
    expect((await stateOf(t, { gate: { allowed: false, reason: "offline" } })).blocker).toEqual({
      kind: "offline",
    });
  });

  it("does not blame the gate when there is nothing left to upload", async () => {
    await seedSelected(t, 2, 2);
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "r0", imageHash: "h0" }),
      remotePhoto({ id: "r1", imageHash: "h1" }),
    ]);
    const state = await stateOf(t, { gate: { allowed: false, reason: "wifi_required" } });
    expect(state.blocker).toBeNull();
    expect(state.stage).toEqual({ kind: "up_to_date", total: 2 });
  });

  it("reports uploads in flight with their own total", async () => {
    await seedSelected(t, 3, 3);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'uploading', 0.4, 0, 1), ('a2', 'pending', 0, 0, 1)`
    );
    expect((await stateOf(t)).stage).toEqual({ kind: "uploading", done: 1, total: 3, inFlight: 1 });
  });

  it("reports failures once nothing else is blocking", async () => {
    await seedSelected(t, 2, 2);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'failed', 0, 2, 1), ('a1', 'done', 1, 0, 1)`
    );
    const state = await stateOf(t);
    expect(state.blocker).toEqual({ kind: "failed", count: 1 });
  });

  it("says it is up to date when everything selected is on the server", async () => {
    await seedSelected(t, 2, 2);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'done', 1, 0, 1), ('a1', 'skipped_exists', 1, 0, 1)`
    );
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "r0", imageHash: "h0" }),
      remotePhoto({ id: "r1", imageHash: "h1" }),
    ]);
    const state = await stateOf(t);
    expect(state.blocker).toBeNull();
    // Each photo once: the queue row and the mirror row are the same photo.
    expect(state.stage).toEqual({ kind: "up_to_date", total: 2 });
  });

  /* -- #2740: uploaded, but the server is still processing ---------------- */

  describe("processing on the server", () => {
    /** Mark `ids` uploaded, as the worker does after `/api/upload/complete/`. */
    async function uploaded(ids: string[]): Promise<void> {
      for (const id of ids) {
        await t.db.run(
          sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
              VALUES (${id}, 'uploading', 1, 0, 1)`
        );
        await markDone(t.db, id, `photo-${id}`);
      }
    }

    /** One delta page, as the sync loop applies it. */
    async function deltaPage(items: SyncPhotosResponse["items"], tombstones: string[] = []): Promise<void> {
      await applyPhotosPage(t.db, { v: 1, items, tombstones, next_cursor: null, server_time: "0" }, 5000);
    }

    it("counts an upload the mirror does not have yet as processing, not as missing", async () => {
      await seedSelected(t, 2, 2);
      await uploaded(["a0", "a1"]);
      const state = await stateOf(t);
      expect(state.counts).toMatchObject({ onServer: 2, processingOnServer: 2 });
      // Never "up to date" while the server still works on them.
      expect(state.stage).toEqual({ kind: "processing", uploaded: 2, processing: 2 });
      expect(state.blocker).toBeNull();
    });

    it("counts a mirrored photo without a thumbnail as processing", async () => {
      await seedSelected(t, 1, 1);
      await uploaded(["a0"]);
      await deltaPage([photoItem("photo-a0", { image_hash: "h0", aspect_ratio: null, timestamp: null })]);
      expect((await stateOf(t)).counts.processingOnServer).toBe(1);
    });

    it("drops to zero once a delta sync brings the photos in with thumbnails", async () => {
      await seedSelected(t, 3, 3);
      await seedRemotePhotos(t.db, [remotePhoto({ id: "r2", imageHash: "h2" })]); // backed up long ago
      await uploaded(["a0", "a1"]);
      expect((await stateOf(t)).stage).toEqual({ kind: "processing", uploaded: 3, processing: 2 });

      await deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      expect((await stateOf(t)).stage).toEqual({ kind: "processing", uploaded: 3, processing: 1 });

      await deltaPage([photoItem("photo-a1", { image_hash: "h1" })]);
      const state = await stateOf(t);
      expect(state.counts.processingOnServer).toBe(0);
      expect(state.stage).toEqual({ kind: "up_to_date", total: 3 });
    });

    it("follows the photo id the completion answered when the hash went stale", async () => {
      // The bytes changed between the hash pass and the upload (an iOS edit):
      // the server photo's hash is not the one stored on the asset.
      await seedSelected(t, 1, 1);
      await uploaded(["a0"]);
      await deltaPage([photoItem("photo-a0", { image_hash: "edited-bytes" })]);
      expect((await stateOf(t)).counts.processingOnServer).toBe(0);
    });

    it("matches a duplicate the server already had by its hash", async () => {
      await seedSelected(t, 1, 1);
      await t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a0', 'skipped_exists', 1, 0, 1)`
      );
      expect((await stateOf(t)).counts.processingOnServer).toBe(1);
      await deltaPage([photoItem("older-photo", { image_hash: "h0" })]);
      expect((await stateOf(t)).counts.processingOnServer).toBe(0);
    });

    it("does not count a photo deleted on the server after it was ready", async () => {
      await seedSelected(t, 1, 1);
      await uploaded(["a0"]);
      await deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      await deltaPage([], ["photo-a0"]);
      const state = await stateOf(t);
      expect(state.counts.processingOnServer).toBe(0);
      expect(state.stage.kind).not.toBe("processing");
    });

    it("keeps the running stage as the headline and counts processing alongside", async () => {
      await seedSelected(t, 2, 2);
      await uploaded(["a0"]);
      await t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a1', 'uploading', 0.5, 0, 1)`
      );
      const state = await stateOf(t);
      expect(state.stage).toEqual({ kind: "uploading", done: 1, total: 2, inFlight: 1 });
      expect(state.counts.processingOnServer).toBe(1);
    });

    it("labels the queue row until the photo is ready", async () => {
      await seedSelected(t, 2, 2);
      await uploaded(["a0"]);
      await t.db.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES ('a1', 'pending', 0, 0, 1)`
      );
      const processing = async () => Object.fromEntries((await queueList(t.db)).map((r): [string, number] => [r.asset_id, r.processing]));
      expect(await processing()).toEqual({ a0: 1, a1: 0 });
      await deltaPage([photoItem("photo-a0", { image_hash: "h0" })]);
      expect(await processing()).toEqual({ a0: 0, a1: 0 });
    });
  });
  /* -- iCloud: photos that are not on the phone at all ------------------- */

  it("counts iCloud-parked assets separately from ones awaiting the hasher", async () => {
    await seedSelected(t, 1, 0); // a0: selected, un-hashed, readable
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    await t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', 'cloud')`);

    const counts = (await stateOf(t)).counts;
    // Folding these together is what would produce a hash bar that never
    // reaches its total on a phone using "Optimise iPhone Storage".
    expect(counts).toMatchObject({ selected: 2, awaitingHash: 1, awaitingRemote: 1 });
  });

  it("names the iCloud wait rather than claiming to be up to date", async () => {
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    await setBackupConfig(t.db, { enabled: true });

    const state = await stateOf(t);
    expect(state.stage).toEqual({ kind: "icloud", pending: 1 });
    expect(state.blocker).toBeNull(); // waiting on a download is not a fault
  });

  it("does not call a queue of iCloud-only assets 'ready to upload'", async () => {
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('cloud', 'pending', 0, 0, 1)`
    );
    expect((await stateOf(t)).stage).toEqual({ kind: "icloud", pending: 1 });
  });

  it("still reports locally-ready uploads while iCloud assets queue behind them", async () => {
    await seedSelected(t, 1, 1); // a0 is hashed and ready
    await insertLocalAsset(t.db, { id: "cloud", hash: null, hashState: "icloud" });
    await t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', 'cloud')`);
    await t.db.run(
      sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
          VALUES ('a0', 'pending', 0, 0, 1), ('cloud', 'pending', 0, 0, 2)`
    );
    expect((await stateOf(t)).stage).toEqual({ kind: "waiting", pending: 1 });
  });
});
