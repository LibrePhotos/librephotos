/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncDeviceMedia, LIMITED_ALBUM_ID } from "../media-sync";
import { getAlbumWatermark, getMediaAccess } from "../media-store";
import { FakeMedia, asset } from "./fake-media";

function assetIds(t: TestDb): string[] {
  return (t.db.all(sql`SELECT id FROM local_asset ORDER BY id`) as { id: string }[]).map((r) => r.id);
}
function membership(t: TestDb, albumId: string): string[] {
  return (
    t.db.all(
      sql`SELECT asset_id FROM local_album_asset WHERE album_id = ${albumId} ORDER BY asset_id`
    ) as { asset_id: string }[]
  ).map((r) => r.asset_id);
}
function hashOf(t: TestDb, id: string): string | null {
  return (t.db.get(sql`SELECT hash FROM local_asset WHERE id = ${id}`) as { hash: string | null }).hash;
}

describe("syncDeviceMedia", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("first sync imports all album assets and sets the access + watermark", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a2", { creationTime: 200 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 5_000 });

    expect(res.access).toBe("all");
    expect(res.added).toBe(2);
    expect(assetIds(t)).toEqual(["a1", "a2"]);
    expect(membership(t, "cam")).toEqual(["a1", "a2"]);
    expect(getAlbumWatermark(t.db, "cam")).toBe(200);
    expect(getMediaAccess(t.db)).toBe("all");
  });

  it("fast path: only fetches assets created after the watermark on the 2nd sync", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [asset("a1", { creationTime: 100 })]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });

    // Add a newer asset; second sync should pick it up via createdAfter.
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a2", { creationTime: 300 }),
    ]);
    media.queries = [];
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.added).toBe(1);
    expect(membership(t, "cam")).toEqual(["a1", "a2"]);
    // The fast-path query used the stored watermark (100), not a full scan.
    expect(media.queries.some((q) => q.createdAfter === 100)).toBe(true);
    expect(getAlbumWatermark(t.db, "cam")).toBe(300);
  });

  it("full diff removes assets deleted from an album (count mismatch trigger)", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a2", { creationTime: 200 }),
      asset("a3", { creationTime: 300 }),
    ]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });
    expect(membership(t, "cam")).toEqual(["a1", "a2", "a3"]);

    // a2 deleted from the album → count drops → full diff unlinks + orphan sweep.
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a3", { creationTime: 300 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.removed).toBe(1);
    expect(res.deleted).toBe(1); // a2 orphaned (no other album) → deleted
    expect(membership(t, "cam")).toEqual(["a1", "a3"]);
    expect(assetIds(t)).toEqual(["a1", "a3"]);
  });

  it("full diff detects a modified asset and invalidates its hash", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100, modificationTime: 100 }),
      asset("a2", { creationTime: 200, modificationTime: 200 }),
      asset("a3", { creationTime: 300, modificationTime: 300 }),
    ]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });
    // Give a1 a hash as if the hasher ran.
    t.db.run(sql`UPDATE local_asset SET hash = 'md5:a1-1' WHERE id = 'a1'`);

    // a3 removed (count 3→2, trips the full diff) AND a1 edited in place.
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100, modificationTime: 999 }),
      asset("a2", { creationTime: 200, modificationTime: 200 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.updated).toBe(1); // a1's modificationTime moved
    expect(res.removed).toBe(1); // a3 gone from the album
    // hash invalidated by the modified_at change (re-queued for hashing).
    expect(hashOf(t, "a1")).toBeNull();
  });

  it("iOS limited access syncs the shown selection as one synthetic album", async () => {
    const media = new FakeMedia();
    media.permission = { granted: true, canAskAgain: false, accessPrivileges: "limited" };
    // In limited mode the provider still answers whole-library queries.
    media.setAlbum("hidden-structure", "Recents", [
      asset("l1", { creationTime: 10 }),
      asset("l2", { creationTime: 20 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 1_000 });

    expect(res.access).toBe("limited");
    expect(res.added).toBe(2);
    expect(membership(t, LIMITED_ALBUM_ID)).toEqual(["l1", "l2"]);
  });

  it("requests permission when not yet granted; no-ops on denial", async () => {
    const media = new FakeMedia();
    media.permission = { granted: false, canAskAgain: true, accessPrivileges: "none" };
    const res = await syncDeviceMedia(t.db, media, { now: 1_000 });
    expect(media.requestCount).toBe(1);
    expect(res.access).toBe("none");
    expect(assetIds(t)).toEqual([]);
  });

  it("is cancellable via an abort signal", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [asset("a1")]);
    const controller = new AbortController();
    controller.abort();
    await expect(syncDeviceMedia(t.db, media, { signal: controller.signal })).rejects.toThrow();
  });
});
