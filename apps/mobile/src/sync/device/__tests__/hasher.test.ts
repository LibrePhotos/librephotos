/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, insertLocalAlbum, insertLocalAsset, type TestDb } from "@librephotos/local-db/testing";
import { clearDeferredHashes, countDeferred, runHashPass, selectUnhashed } from "../hasher";
import { upsertLocalAssets } from "../media-store";
import { asset, FakeHasher } from "./fake-media";

async function hashOf(t: TestDb, id: string): Promise<string | null> {
  return (await t.db.get<{ hash: string | null }>(sql`SELECT hash FROM local_asset WHERE id = ${id}`)).hash;
}
async function stateOf(t: TestDb, id: string): Promise<string | null> {
  return (await t.db.get<{ hash_state: string | null; }>(sql`SELECT hash_state FROM local_asset WHERE id = ${id}`)).hash_state;
}
async function hashedAtOf(t: TestDb, id: string): Promise<number | null> {
  return (await t.db.get<{ hashed_at: number | null; }>(sql`SELECT hashed_at FROM local_asset WHERE id = ${id}`)).hashed_at;
}

describe("runHashPass", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("stores md5 + userId, matching the server File.hash rule", async () => {
    await insertLocalAsset(t.db, { id: "a1" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });

    const res = await runHashPass(t.db, new FakeHasher(), { userId: 7, now: 1_000 });
    expect(res.hashed).toBe(1);
    expect(await hashOf(t, "a1")).toBe("md5:a17");
  });

  it("orders backup-selected albums first", async () => {
    await insertLocalAsset(t.db, { id: "sel", createdAt: 1 });
    await insertLocalAsset(t.db, { id: "other", createdAt: 2 });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["sel"] });
    await insertLocalAlbum(t.db, { id: "misc", backupSelection: 0, assetIds: ["other"] });

    const hasher = new FakeHasher();
    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });
    expect(hasher.order[0]).toBe("sel"); // selected hashed before unselected
  });

  it("skips videos unless includeVideos is set (lazy video hashing)", async () => {
    await insertLocalAsset(t.db, { id: "vid", type: "video" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["vid"] });

    // Default pass: no videos.
    const images = await selectUnhashed(t.db, { limit: 10 });
    expect(images.map((c) => c.id)).not.toContain("vid");

    const withVideos = await selectUnhashed(t.db, { limit: 10, includeVideos: true });
    expect(withVideos.map((c) => c.id)).toContain("vid");

    const res = await runHashPass(t.db, new FakeHasher(), { userId: 1, includeVideos: true, now: 1_000 });
    expect(res.hashed).toBe(1);
  });

  it("restricts to selected albums when selectedOnly is set", async () => {
    await insertLocalAsset(t.db, { id: "sel" });
    await insertLocalAsset(t.db, { id: "excl" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["sel"] });
    await insertLocalAlbum(t.db, { id: "trash", backupSelection: 2, assetIds: ["excl"] });

    const rows = await selectUnhashed(t.db, { limit: 10, selectedOnly: true });
    expect(rows.map((r) => r.id)).toEqual(["sel"]);
  });

  it("records a permanent read failure without blocking the pass or enqueue", async () => {
    await insertLocalAsset(t.db, { id: "good" });
    await insertLocalAsset(t.db, { id: "bad" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["good", "bad"] });
    const hasher = new FakeHasher();
    hasher.fail.add("bad");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });
    expect(res.hashed).toBe(1);
    expect(res.failed).toBe(1);
    expect(await hashOf(t, "good")).toBe("md5:good1");
    // Failure leaves hash NULL (never enqueued) but hashed_at set (not re-picked).
    expect(await hashOf(t, "bad")).toBeNull();
    expect((await selectUnhashed(t.db, { limit: 10 })).map((c) => c.id)).toEqual([]);
  });

  it("re-hashes an asset after a modified_at change invalidates its hash", async () => {
    await insertLocalAsset(t.db, { id: "a1", createdAt: 100 });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    await runHashPass(t.db, new FakeHasher(), { userId: 1, now: 1_000 });
    expect(await hashOf(t, "a1")).toBe("md5:a11");

    // A media re-scan with a newer modificationTime invalidates the hash.
    await upsertLocalAssets(t.db, [asset("a1", { creationTime: 100, modificationTime: 500 })]);
    expect(await hashOf(t, "a1")).toBeNull();
    expect((await selectUnhashed(t.db, { limit: 10 })).map((c) => c.id)).toEqual(["a1"]);
  });

  it("parks an iCloud-only asset instead of hashing it, and never re-selects it", async () => {
    await insertLocalAsset(t.db, { id: "here" });
    await insertLocalAsset(t.db, { id: "cloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["here", "cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    // Deferred is its own outcome: not hashed, and emphatically not failed.
    expect(res).toMatchObject({ hashed: 1, failed: 0, deferred: 1 });
    expect(await hashOf(t, "here")).toBe("md5:here1");
    expect(await hashOf(t, "cloud")).toBeNull();
    expect(await stateOf(t, "cloud")).toBe("icloud");
    // hashed_at stays NULL — nothing was attempted, it is waiting — but the
    // selector must still drop it, or `more` would be true forever and the
    // hash_batch chain would spin on an asset it can never make progress on.
    expect(await hashedAtOf(t, "cloud")).toBeNull();
    expect((await selectUnhashed(t.db, { limit: 10 })).map((c) => c.id)).toEqual([]);
    expect(await countDeferred(t.db)).toBe(1);

    // A second pass does no work at all rather than re-asking the media library.
    const again = await runHashPass(t.db, hasher, { userId: 1, now: 2_000 });
    expect(again).toMatchObject({ hashed: 0, deferred: 0, more: false });
    expect(hasher.order).toEqual(["here", "cloud"]);
  });

  it("never materialises (downloads) anything on the hash path", async () => {
    await insertLocalAsset(t.db, { id: "cloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");

    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    // The bug in one assertion: hashing must not fetch bytes over the network.
    expect(hasher.materialized).toEqual([]);
  });

  it("un-parks deferred assets on request, so a storage-setting change recovers", async () => {
    await insertLocalAsset(t.db, { id: "cloud" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["cloud"] });
    const hasher = new FakeHasher();
    hasher.remote.add("cloud");
    await runHashPass(t.db, hasher, { userId: 1, now: 1_000 });

    expect(await clearDeferredHashes(t.db)).toBe(1);
    expect((await selectUnhashed(t.db, { limit: 10 })).map((c) => c.id)).toEqual(["cloud"]);

    // The original has come back down to the device since.
    hasher.remote.delete("cloud");
    const res = await runHashPass(t.db, hasher, { userId: 1, now: 2_000 });
    expect(res.hashed).toBe(1);
    expect(await hashOf(t, "cloud")).toBe("md5:cloud1");
    expect(await stateOf(t, "cloud")).toBeNull();
  });

  it("counts a deferral against the per-job budget so a batch stays bounded", async () => {
    for (const id of ["a", "b", "c"]) (await insertLocalAsset(t.db, { id }));
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a", "b", "c"] });
    const hasher = new FakeHasher();
    hasher.remote.add("a").add("b").add("c");

    const res = await runHashPass(t.db, hasher, { userId: 1, now: 1_000, maxAssets: 2 });

    expect(res.deferred).toBe(2);
    expect(hasher.order).toHaveLength(2);
    expect(res.more).toBe(true); // the third is still un-attempted
  });

  it("is cancellable between batches", async () => {
    await insertLocalAsset(t.db, { id: "a1" });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runHashPass(t.db, new FakeHasher(), { userId: 1, signal: controller.signal })
    ).rejects.toThrow();
  });
});
