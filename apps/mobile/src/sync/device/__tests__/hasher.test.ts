/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset } from "@/db/__tests__/fixtures";
import { clearDeferredHashes, countDeferred, runHashPass, selectUnhashed } from "../hasher";
import { upsertLocalAssets } from "../media-store";
import { asset, FakeHasher } from "./fake-media";

function hashOf(t: TestDb, id: string): string | null {
  return (t.db.get(sql`SELECT hash FROM local_asset WHERE id = ${id}`) as { hash: string | null }).hash;
}
function stateOf(t: TestDb, id: string): string | null {
  return (t.db.get(sql`SELECT hash_state FROM local_asset WHERE id = ${id}`) as {
    hash_state: string | null;
  }).hash_state;
}
function hashedAtOf(t: TestDb, id: string): number | null {
  return (t.db.get(sql`SELECT hashed_at FROM local_asset WHERE id = ${id}`) as {
    hashed_at: number | null;
  }).hashed_at;
}

describe("runHashPass", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("stores md5 + userId, matching the server File.hash rule", async () => {
    insertLocalAsset(t.db, { id: "a1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });

    const res = await runHashPass(t.db, new FakeHasher(), { userId: 7, now: 1_000 });
    expect(res.hashed).toBe(1);
    expect(hashOf(t, "a1")).toBe("md5:a17"); // "md5:a1" + "7"
  });

  it("orders backup-selected albums first", async () => {
    insertLocalAsset(t.db, { id: "sel", createdAt: 1 });
    insertLocalAsset(t.db, { id: "other", createdAt: 2 });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["sel"] });
    insertLocalAlbum(t.db, { id: "misc", backupSelection: 0, assetIds: ["other"] });

    const hasher = new FakeHasher();
    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });
    expect(hasher.order[0]).toBe("sel"); // selected hashed before unselected
  });

  it("skips videos unless includeVideos is set (lazy video hashing)", async () => {
    insertLocalAsset(t.db, { id: "vid", type: "video" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["vid"] });

    // Default pass: no videos.
    const images = selectUnhashed(t.db, { limit: 10 });
    expect(images.map((c) => c.id)).not.toContain("vid");

    const withVideos = selectUnhashed(t.db, { limit: 10, includeVideos: true });
    expect(withVideos.map((c) => c.id)).toContain("vid");

    const res = await runHashPass(t.db, new FakeHasher(), { userId: 1, includeVideos: true, now: 1_000 });
    expect(res.hashed).toBe(1);
  });

  it("restricts to selected albums when selectedOnly is set", async () => {
    insertLocalAsset(t.db, { id: "sel" });
    insertLocalAsset(t.db, { id: "excl" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["sel"] });
    insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["excl"] });

    const rows = selectUnhashed(t.db, { limit: 10, selectedOnly: true });
    expect(rows.map((r) => r.id)).toEqual(["sel"]);
  });

  it("records a permanent read failure without blocking the pass or enqueue", async () => {
    insertLocalAsset(t.db, { id: "good" });
    insertLocalAsset(t.db, { id: "bad" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["good", "bad"] });
    const hasher = new FakeHasher();
    hasher.fail.add("bad");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });
    expect(res.hashed).toBe(1);
    expect(res.failed).toBe(1);
    expect(hashOf(t, "good")).toBe("md5:good1");
    // Failure leaves hash NULL (never enqueued) but hashed_at set (not re-picked).
    expect(hashOf(t, "bad")).toBeNull();
    expect(selectUnhashed(t.db, { limit: 10 }).map((c) => c.id)).toEqual([]);
  });

  it("re-hashes an asset after a modified_at change invalidates its hash", async () => {
    insertLocalAsset(t.db, { id: "a1", createdAt: 100 });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    await runHashPass(t.db, new FakeHasher(), { userId: 1, now: 1_000 });
    expect(hashOf(t, "a1")).toBe("md5:a11");

    // A media re-scan with a newer modificationTime invalidates the hash.
    upsertLocalAssets(t.db, [asset("a1", { creationTime: 100, modificationTime: 500 })]);
    expect(hashOf(t, "a1")).toBeNull();
    expect(selectUnhashed(t.db, { limit: 10 }).map((c) => c.id)).toEqual(["a1"]);
  });

  it("parks an iCloud-only asset instead of hashing it, and never re-selects it", async () => {
    insertLocalAsset(t.db, { id: "here" });
    insertLocalAsset(t.db, { id: "cloud" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["here", "cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    // Deferred is its own outcome: not hashed, and emphatically not failed.
    expect(res).toMatchObject({ hashed: 1, failed: 0, deferred: 1 });
    expect(hashOf(t, "here")).toBe("md5:here1");
    expect(hashOf(t, "cloud")).toBeNull();
    expect(stateOf(t, "cloud")).toBe("icloud");
    // hashed_at stays NULL — nothing was attempted, it is waiting — but the
    // selector must still drop it, or `more` would be true forever and the
    // hash_batch chain would spin on an asset it can never make progress on.
    expect(hashedAtOf(t, "cloud")).toBeNull();
    expect(selectUnhashed(t.db, { limit: 10 }).map((c) => c.id)).toEqual([]);
    expect(countDeferred(t.db)).toBe(1);

    // A second pass does no work at all rather than re-asking the media library.
    const again = await runHashPass(t.db, hasher, { userId: 1, now: 2_000 });
    expect(again).toMatchObject({ hashed: 0, deferred: 0, more: false });
    expect(hasher.order).toEqual(["here", "cloud"]);
  });

  it("never materialises (downloads) anything on the hash path", async () => {
    insertLocalAsset(t.db, { id: "cloud" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");

    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    // The bug in one assertion: hashing must not fetch bytes over the network.
    expect(hasher.materialized).toEqual([]);
  });

  it("un-parks deferred assets on request, so a storage-setting change recovers", async () => {
    insertLocalAsset(t.db, { id: "cloud" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");
    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    expect(clearDeferredHashes(t.db)).toBe(1);
    expect(selectUnhashed(t.db, { limit: 10 }).map((c) => c.id)).toEqual(["cloud"]);

    // The original has come back down to the device since.
    hasher.remote.delete("cloud");
    const res = await runHashPass(t.db, hasher, { userId: 1, now: 2_000 });
    expect(res.hashed).toBe(1);
    expect(hashOf(t, "cloud")).toBe("md5:cloud1");
    expect(stateOf(t, "cloud")).toBeNull();
  });

  it("counts a deferral against the per-job budget so a batch stays bounded", async () => {
    for (const id of ["a", "b", "c"]) insertLocalAsset(t.db, { id });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a", "b", "c"] });
    const hasher = new FakeHasher();
    hasher.remote.add("a").add("b").add("c");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000, maxAssets: 2 });

    expect(res.deferred).toBe(2);
    expect(hasher.order).toHaveLength(2);
    expect(res.more).toBe(true); // the third is still un-attempted
  });

  it("is cancellable between batches", async () => {
    insertLocalAsset(t.db, { id: "a1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runHashPass(t.db, new FakeHasher(), { userId: 1, signal: controller.signal })
    ).rejects.toThrow();
  });
});
