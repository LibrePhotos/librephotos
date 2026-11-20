import { sql } from "drizzle-orm";
import { createTestDb, type TestDb, rawCount } from "@librephotos/local-db/testing";
import { syncDeviceMedia, LIBRARY_ALBUM_ID, LIMITED_ALBUM_ID } from "../media-sync";
import { getAlbumWatermark, getMediaAccess } from "../media-store";
import { timelinePage } from "@librephotos/local-db";
import { FakeMedia, asset } from "./fake-media";

async function assetIds(t: TestDb): Promise<string[]> {
  return (await t.db.all<{ id: string }>(sql`SELECT id FROM local_asset ORDER BY id`)).map((r) => r.id);
}
async function membership(t: TestDb, albumId: string): Promise<string[]> {
  return (
    await t.db.all<{ asset_id: string }>(
      sql`SELECT asset_id FROM local_album_asset WHERE album_id = ${albumId} ORDER BY asset_id`
    )
  ).map((r) => r.asset_id);
}
async function hashOf(t: TestDb, id: string): Promise<string | null> {
  return (await t.db.get<{ hash: string | null }>(sql`SELECT hash FROM local_asset WHERE id = ${id}`)).hash;
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
    expect(await assetIds(t)).toEqual(["a1", "a2"]);
    expect(await membership(t, "cam")).toEqual(["a1", "a2"]);
    expect(await getAlbumWatermark(t.db, "cam")).toBe(200);
    expect(await getMediaAccess(t.db)).toBe("all");
  });

  it("fast path: only fetches assets created after the watermark on the 2nd sync", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [asset("a1", { creationTime: 100 })]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });

    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a2", { creationTime: 300 }),
    ]);
    media.queries = [];
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.added).toBe(1);
    expect(await membership(t, "cam")).toEqual(["a1", "a2"]);
    expect(media.queries.some((q) => q.createdAfter === 100)).toBe(true);
    expect(await getAlbumWatermark(t.db, "cam")).toBe(300);
  });

  it("full diff removes assets deleted from an album (count mismatch trigger)", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a2", { creationTime: 200 }),
      asset("a3", { creationTime: 300 }),
    ]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });
    expect(await membership(t, "cam")).toEqual(["a1", "a2", "a3"]);

    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100 }),
      asset("a3", { creationTime: 300 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.removed).toBe(1);
    expect(res.deleted).toBe(1);
    expect(await membership(t, "cam")).toEqual(["a1", "a3"]);
    expect(await assetIds(t)).toEqual(["a1", "a3"]);
  });

  it("full diff detects a modified asset and invalidates its hash", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100, modificationTime: 100 }),
      asset("a2", { creationTime: 200, modificationTime: 200 }),
      asset("a3", { creationTime: 300, modificationTime: 300 }),
    ]);
    await syncDeviceMedia(t.db, media, { now: 1_000 });
    await t.db.run(sql`UPDATE local_asset SET hash = 'md5:a1-1' WHERE id = 'a1'`);

    media.setAlbum("cam", "Camera", [
      asset("a1", { creationTime: 100, modificationTime: 999 }),
      asset("a2", { creationTime: 200, modificationTime: 200 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.updated).toBe(1);
    expect(res.removed).toBe(1);
    expect(await hashOf(t, "a1")).toBeNull();
  });

  it("iOS limited access syncs the shown selection as one synthetic album", async () => {
    const media = new FakeMedia();
    media.permission = { granted: true, canAskAgain: false, accessPrivileges: "limited" };
    media.setAlbum("hidden-structure", "Recents", [
      asset("l1", { creationTime: 10 }),
      asset("l2", { creationTime: 20 }),
    ]);
    const res = await syncDeviceMedia(t.db, media, { now: 1_000 });

    expect(res.access).toBe("limited");
    expect(res.added).toBe(2);
    expect(await membership(t, LIMITED_ALBUM_ID)).toEqual(["l1", "l2"]);
  });

  it("requests permission when not yet granted; no-ops on denial", async () => {
    const media = new FakeMedia();
    media.permission = { granted: false, canAskAgain: true, accessPrivileges: "none" };
    const res = await syncDeviceMedia(t.db, media, { now: 1_000 });
    expect(media.requestCount).toBe(1);
    expect(res.access).toBe("none");
    expect(await assetIds(t)).toEqual([]);
  });

  it("is cancellable via an abort signal", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", [asset("a1")]);
    const controller = new AbortController();
    controller.abort();
    await expect(syncDeviceMedia(t.db, media, { signal: controller.signal })).rejects.toThrow();
  });
});

describe("syncDeviceMedia — large libraries stay responsive", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  function library(count: number, prefix = "p"): ReturnType<typeof asset>[] {
    return Array.from({ length: count }, (_, i) =>
      asset(`${prefix}${String(i).padStart(5, "0")}`, { creationTime: 1_000 + i })
    );
  }

  async function rowCount(db: TestDb["db"]): Promise<number> {
    return (await db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM local_asset`)).c;
  }

  it("enumerates the library once and never walks iOS smart albums", async () => {
    const media = new FakeMedia();
    const all = library(40);
    media.setAlbum("recents", "Recents", all, { isSmart: true });
    media.setAlbum("favorites", "Favorites", all.slice(0, 20), { isSmart: true });
    media.setAlbum("screenshots", "Screenshots", all.slice(20), { isSmart: true });
    media.setAlbum("trip", "Trip", all.slice(0, 5));

    const res = await syncDeviceMedia(t.db, media, { now: 1_000, pageSize: 10 });

    const scoped = media.queries.map((q) => q.albumId).filter((id): id is string => id != null);
    expect(scoped).not.toContain("recents");
    expect(scoped).not.toContain("favorites");
    expect(scoped).not.toContain("screenshots");
    expect(new Set(scoped)).toEqual(new Set(["trip"]));
    expect(await membership(t, LIBRARY_ALBUM_ID)).toHaveLength(40);
    expect(res.added).toBe(40);
    expect(res.albums).toBe(2);
  });

  it("writes each asset once even when several albums contain it", async () => {
    const media = new FakeMedia();
    const all = library(60);
    media.setAlbum("cam", "Camera", all);
    media.setAlbum("trip", "Trip", all);
    media.setAlbum("faves", "Faves", all);

    const res = await syncDeviceMedia(t.db, media, { now: 1_000, pageSize: 20 });

    expect(await rowCount(t.db)).toBe(60);
    expect(res.added).toBe(60);
    expect(res.scanned).toBe(240);
    expect(res.upserted).toBe(60);
    expect(await membership(t, "trip")).toHaveLength(60);
    expect(await membership(t, "faves")).toHaveLength(60);
  });

  it("pages the provider and yields between every page", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(500));
    let yields = 0;

    await syncDeviceMedia(t.db, media, {
      now: 1_000,
      pageSize: 50,
      yield: async () => {
        yields += 1;
      },
    });

    expect(media.queries.every((q) => q.first <= 50)).toBe(true);
    expect(yields).toBeGreaterThanOrEqual(20);
  });

  it("actually returns the JS thread to the event loop while it runs", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(400));

    let ticks = 0;
    let stop = false;
    const tick = () => {
      if (stop) return;
      ticks += 1;
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);

    await syncDeviceMedia(t.db, media, { now: 1_000, pageSize: 25 });
    stop = true;

    expect(ticks).toBeGreaterThan(5);
  });

  it("commits rows page by page so the first photos render before the scan ends", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(300));
    let rowsAtFirstProgress: number | null = null;

    await syncDeviceMedia(t.db, media, {
      now: 1_000,
      pageSize: 50,
      onProgress: (p) => {
        if (rowsAtFirstProgress == null) rowsAtFirstProgress = rawCount(t, "SELECT COUNT(*) AS c FROM local_asset");
        expect(p.total).toBeGreaterThan(0);
      },
    });

    expect(rowsAtFirstProgress).toBe(50);
    expect(await rowCount(t.db)).toBe(300);
  });

  it("bounds a huge first pass and resumes exactly where it stopped", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(250));

    const first = await syncDeviceMedia(t.db, media, {
      now: 1_000,
      pageSize: 50,
      maxAssetsPerRun: 100,
    });
    expect(first.complete).toBe(false);
    expect(await rowCount(t.db)).toBe(100);
    expect(first.deleted).toBe(0);
    expect(first.removed).toBe(0);

    const second = await syncDeviceMedia(t.db, media, { now: 2_000, pageSize: 50 });
    expect(second.complete).toBe(true);
    expect(await rowCount(t.db)).toBe(250);
    expect(await membership(t, LIBRARY_ALBUM_ID)).toHaveLength(250);
  });
});

describe("syncDeviceMedia — dropping smart albums must not hide anything", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  async function seedPreUpgradeSmartAlbum(ids: string[]): Promise<void> {
    await t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('recents', 'Recents', ${ids.length}, 0, 1)`
    );
    for (const id of ids) {
      await t.db.run(
        sql`INSERT INTO local_asset (id, name, type, created_at, modified_at, width, height, uri)
            VALUES (${id}, ${id}, 'image', 1000, 1000, 100, 100, ${`ph://${id}`})`
      );
      await t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('recents', ${id})`);
    }
  }

  it("keeps a smart album's rows, membership and backup selection after a scan that ignores it", async () => {
    await seedPreUpgradeSmartAlbum(["a1", "a2"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1"), asset("a2")], { isSmart: true });

    await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(media.queries.map((q) => q.albumId)).not.toContain("recents");
    expect(await membership(t, "recents")).toEqual(["a1", "a2"]);
    const row = await t.db.get<{ backup_selection: number }>(
      sql`SELECT backup_selection FROM local_album WHERE id = 'recents'`
    );
    expect(row.backup_selection).toBe(1);
    expect(await membership(t, LIBRARY_ALBUM_ID)).toEqual(["a1", "a2"]);
  });

  it("leaves those assets in the merged timeline", async () => {
    await seedPreUpgradeSmartAlbum(["a1", "a2"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1"), asset("a2")], { isSmart: true });

    await syncDeviceMedia(t.db, media, { now: 2_000 });

    const { rows } = await timelinePage(t.db, { limit: 100 });
    expect(rows.map((r) => r.local_id).sort()).toEqual(["a1", "a2"]);
  });

  it("does not orphan-sweep an asset just because its smart album went unwalked", async () => {
    await seedPreUpgradeSmartAlbum(["a1"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1")], { isSmart: true });

    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.deleted).toBe(0);
    expect(await assetIds(t)).toEqual(["a1"]);
  });
});
