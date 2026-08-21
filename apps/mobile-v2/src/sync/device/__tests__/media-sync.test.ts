/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncDeviceMedia, LIBRARY_ALBUM_ID, LIMITED_ALBUM_ID } from "../media-sync";
import { getAlbumWatermark, getMediaAccess } from "../media-store";
import { timelinePage } from "@/db/queries/timeline";
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

/**
 * Regression cover for the device-run freeze: granting photo-library access
 * locked the UI for the whole enumeration. Each test below pins one of the
 * three causes (smart-album fan-out, no yielding, unbounded buffering) plus the
 * budget/resume path that keeps a huge library from monopolising one run.
 */
describe("syncDeviceMedia — large libraries stay responsive", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  /** `count` assets with strictly increasing creation times. */
  function library(count: number, prefix = "p"): ReturnType<typeof asset>[] {
    return Array.from({ length: count }, (_, i) =>
      asset(`${prefix}${String(i).padStart(5, "0")}`, { creationTime: 1_000 + i })
    );
  }

  function rowCount(db: TestDb["db"]): number {
    return (db.get(sql`SELECT COUNT(*) AS c FROM local_asset`) as { c: number }).c;
  }

  it("enumerates the library once and never walks iOS smart albums", async () => {
    const media = new FakeMedia();
    const all = library(40);
    // What iOS actually reports: a pile of smart albums over the same photos.
    media.setAlbum("recents", "Recents", all, { isSmart: true });
    media.setAlbum("favorites", "Favorites", all.slice(0, 20), { isSmart: true });
    media.setAlbum("screenshots", "Screenshots", all.slice(20), { isSmart: true });
    media.setAlbum("trip", "Trip", all.slice(0, 5)); // a real user album

    const res = await syncDeviceMedia(t.db, media, { now: 1_000, pageSize: 10 });

    const scoped = media.queries.map((q) => q.albumId).filter((id): id is string => id != null);
    expect(scoped).not.toContain("recents");
    expect(scoped).not.toContain("favorites");
    expect(scoped).not.toContain("screenshots");
    expect(new Set(scoped)).toEqual(new Set(["trip"]));
    // The synthetic library album covers every asset the smart albums held.
    expect(membership(t, LIBRARY_ALBUM_ID)).toHaveLength(40);
    expect(res.added).toBe(40);
    expect(res.albums).toBe(2); // library + the one user album
  });

  it("writes each asset once even when several albums contain it", async () => {
    const media = new FakeMedia();
    const all = library(60);
    media.setAlbum("cam", "Camera", all);
    media.setAlbum("trip", "Trip", all); // fully overlapping user album
    media.setAlbum("faves", "Faves", all);

    const res = await syncDeviceMedia(t.db, media, { now: 1_000, pageSize: 20 });

    expect(rowCount(t.db)).toBe(60);
    expect(res.added).toBe(60);
    // Four passes read the same 60 assets, but only the first pass writes them.
    expect(res.scanned).toBe(240);
    expect(res.upserted).toBe(60);
    // Album membership is still complete for every album.
    expect(membership(t, "trip")).toHaveLength(60);
    expect(membership(t, "faves")).toHaveLength(60);
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

    // No page may be larger than the page size — that is what keeps a single
    // native call and a single transaction inside a frame budget.
    expect(media.queries.every((q) => q.first <= 50)).toBe(true);
    // 500 assets over two albums (library + cam) at 50/page = 20 pages minimum.
    expect(yields).toBeGreaterThanOrEqual(20);
  });

  it("actually returns the JS thread to the event loop while it runs", async () => {
    const media = new FakeMedia();
    media.setAlbum("cam", "Camera", library(400));

    // A self-rescheduling macrotask: it can only advance if syncDeviceMedia
    // gives the event loop a turn. Awaiting promises alone would never let it
    // tick, which is exactly how the app froze.
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
        if (rowsAtFirstProgress == null) rowsAtFirstProgress = rowCount(t.db);
        expect(p.total).toBeGreaterThan(0);
      },
    });

    // Photos were queryable after the very first page, not only at the end.
    expect(rowsAtFirstProgress).toBe(50);
    expect(rowCount(t.db)).toBe(300);
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
    expect(rowCount(t.db)).toBe(100);
    // A truncated run must not mistake unread assets for deletions.
    expect(first.deleted).toBe(0);
    expect(first.removed).toBe(0);

    const second = await syncDeviceMedia(t.db, media, { now: 2_000, pageSize: 50 });
    expect(second.complete).toBe(true);
    expect(rowCount(t.db)).toBe(250);
    expect(membership(t, LIBRARY_ALBUM_ID)).toHaveLength(250);
  });
});

/**
 * Device report: "backed up images disappear from the timeline."
 *
 * One hypothesis was backup selection: the scan stopped enumerating iOS smart
 * albums (the library is walked once as a synthetic `__library__` album), so an
 * asset the user had made backup-eligible only through a smart album could have
 * ended up in no backup-selected album and dropped out of the merged timeline —
 * with no upload involved at all.
 *
 * It does not happen, and these tests hold that line: nothing prunes album rows
 * or their memberships, so a selection made before the change keeps working,
 * and every asset is (re)linked to the whole-library album on every run anyway.
 *
 * They also pin the one genuine consequence of the change, which is *not* a
 * disappearance: an album the provider no longer reports stops accumulating new
 * assets, so a user whose only selected album is a stale smart album will not
 * see photos taken after the upgrade until they select something current.
 */
describe("syncDeviceMedia — dropping smart albums must not hide anything", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  /** The DB an install that still enumerated smart albums would have left. */
  function seedPreUpgradeSmartAlbum(ids: string[]): void {
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('recents', 'Recents', ${ids.length}, 0, 1)`
    );
    for (const id of ids) {
      t.db.run(
        sql`INSERT INTO local_asset (id, name, type, created_at, modified_at, width, height, uri)
            VALUES (${id}, ${id}, 'image', 1000, 1000, 100, 100, ${`ph://${id}`})`
      );
      t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES ('recents', ${id})`);
    }
  }

  it("keeps a smart album's rows, membership and backup selection after a scan that ignores it", async () => {
    seedPreUpgradeSmartAlbum(["a1", "a2"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1"), asset("a2")], { isSmart: true });

    await syncDeviceMedia(t.db, media, { now: 2_000 });

    // The scan never walks the smart album…
    expect(media.queries.map((q) => q.albumId)).not.toContain("recents");
    // …and never takes its rows away either, so the user's selection survives.
    expect(membership(t, "recents")).toEqual(["a1", "a2"]);
    const row = t.db.get(
      sql`SELECT backup_selection FROM local_album WHERE id = 'recents'`
    ) as { backup_selection: number };
    expect(row.backup_selection).toBe(1);
    // Both assets are also covered by the whole-library pass.
    expect(membership(t, LIBRARY_ALBUM_ID)).toEqual(["a1", "a2"]);
  });

  it("leaves those assets in the merged timeline", async () => {
    seedPreUpgradeSmartAlbum(["a1", "a2"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1"), asset("a2")], { isSmart: true });

    await syncDeviceMedia(t.db, media, { now: 2_000 });

    const { rows } = timelinePage(t.db, { limit: 100 });
    expect(rows.map((r) => r.local_id).sort()).toEqual(["a1", "a2"]);
  });

  it("does not orphan-sweep an asset just because its smart album went unwalked", async () => {
    seedPreUpgradeSmartAlbum(["a1"]);
    const media = new FakeMedia();
    media.setAlbum("recents", "Recents", [asset("a1")], { isSmart: true });

    const res = await syncDeviceMedia(t.db, media, { now: 2_000 });

    expect(res.deleted).toBe(0);
    expect(assetIds(t)).toEqual(["a1"]);
  });
});
