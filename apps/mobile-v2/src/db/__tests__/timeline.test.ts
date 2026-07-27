/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from "../test-db";
import { timelineBuckets, timelineCursorFor, timelinePage } from "../queries/timeline";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "./fixtures";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("merged timeline", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("returns only visible, timestamped remote photos newest-first", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", timestamp: D(2024, 1, 3) }),
      remotePhoto({ id: "b", timestamp: D(2024, 1, 1) }),
      remotePhoto({ id: "c", timestamp: D(2024, 1, 2) }),
      remotePhoto({ id: "hid", timestamp: D(2024, 1, 5), hidden: true }),
      remotePhoto({ id: "trash", timestamp: D(2024, 1, 6), inTrashcan: true }),
      remotePhoto({ id: "rm", timestamp: D(2024, 1, 7), removed: true }),
      remotePhoto({ id: "nots", timestamp: null }),
    ]);
    const { rows } = timelinePage(t.db, { limit: 100 });
    expect(rows.map((r) => r.remote_id)).toEqual(["a", "c", "b"]);
    expect(rows.every((r) => r.local_id === null)).toBe(true);
  });

  it("keyset-paginates without gaps or duplicates", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      remotePhoto({ id: `p${String(i).padStart(2, "0")}`, timestamp: D(2024, 1, 1) + i * 86400000 })
    );
    seedRemotePhotos(t.db, rows);

    const seen: string[] = [];
    let cursor = null as null | { timestamp: number; sortId: string };
    for (let guard = 0; guard < 10; guard++) {
      const page = timelinePage(t.db, { limit: 10, cursor });
      seen.push(...page.rows.map((r) => r.remote_id as string));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    // Descending by timestamp.
    expect(seen[0]).toBe("p24");
    expect(seen[24]).toBe("p00");
  });

  it("groups buckets by day with correct counts", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "b", timestamp: D(2024, 1, 3), bucketDay: "2024-01-03" }),
      remotePhoto({ id: "c", timestamp: D(2024, 1, 2), bucketDay: "2024-01-02" }),
    ]);
    const buckets = timelineBuckets(t.db);
    expect(buckets).toEqual([
      { bucket_day: "2024-01-03", count: 2 },
      { bucket_day: "2024-01-02", count: 1 },
    ]);
  });

  describe("local-only arm (union shape, Phase 3 preview)", () => {
    it("includes a backup-selected local asset with no remote counterpart", () => {
      insertLocalAsset(t.db, { id: "L1", hash: "onlylocal", createdAt: D(2024, 2, 1) });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L1"] });

      const { rows } = timelinePage(t.db, { limit: 100 });
      expect(rows).toHaveLength(1);
      expect(rows[0].local_id).toBe("L1");
      expect(rows[0].remote_id).toBeNull();
      expect(rows[0].image_hash).toBe("onlylocal");
    });

    it("absorbs a local asset whose hash matches a remote photo (join, no dup)", () => {
      seedRemotePhotos(t.db, [remotePhoto({ id: "r1", imageHash: "shared", timestamp: D(2024, 2, 2) })]);
      insertLocalAsset(t.db, { id: "L2", hash: "shared", createdAt: D(2024, 2, 2) });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L2"] });

      const { rows } = timelinePage(t.db, { limit: 100 });
      expect(rows).toHaveLength(1);
      expect(rows[0].remote_id).toBe("r1");
      expect(rows[0].local_id).toBe("L2"); // "also on this device"
      expect(rows[0].local_uri).toBe("ph://L2");
    });

    it("excludes assets not in a backup-selected album, or in an excluded album", () => {
      insertLocalAsset(t.db, { id: "L3", hash: "h3", createdAt: D(2024, 2, 3) }); // no album
      insertLocalAsset(t.db, { id: "L4", hash: "h4", createdAt: D(2024, 2, 4) });
      insertLocalAlbum(t.db, { id: "excluded", backupSelection: 2, assetIds: ["L4"] });
      insertLocalAsset(t.db, { id: "L5", hash: "h5", createdAt: D(2024, 2, 5) });
      insertLocalAlbum(t.db, { id: "sel", backupSelection: 1, assetIds: ["L5"] });

      const { rows } = timelinePage(t.db, { limit: 100 });
      expect(rows.map((r) => r.local_id)).toEqual(["L5"]);
    });

    it("limits each arm without losing the merge order", () => {
      // Ten remote and ten local rows interleaved in time. If either arm were
      // limited *before* the interleave was understood — or not limited at all —
      // this page would not alternate.
      seedRemotePhotos(
        t.db,
        Array.from({ length: 10 }, (_, i) =>
          remotePhoto({ id: `r${i}`, imageHash: `rh${i}`, timestamp: D(2024, 1, 1) + i * 2 * 3600_000 })
        )
      );
      for (let i = 0; i < 10; i++) {
        insertLocalAsset(t.db, {
          id: `L${i}`,
          hash: `lh${i}`,
          createdAt: D(2024, 1, 1) + (i * 2 + 1) * 3600_000,
        });
      }
      insertLocalAlbum(t.db, {
        id: "cam",
        backupSelection: 1,
        assetIds: Array.from({ length: 10 }, (_, i) => `L${i}`),
      });

      const { rows } = timelinePage(t.db, { limit: 6 });
      expect(rows.map((r) => r.remote_id ?? r.local_id)).toEqual([
        "L9",
        "r9",
        "L8",
        "r8",
        "L7",
        "r7",
      ]);
    });

    it("orders remote and local rows together by timestamp", () => {
      seedRemotePhotos(t.db, [
        remotePhoto({ id: "r-old", imageHash: "ro", timestamp: D(2024, 1, 1) }),
        remotePhoto({ id: "r-new", imageHash: "rn", timestamp: D(2024, 3, 1) }),
      ]);
      insertLocalAsset(t.db, { id: "L-mid", hash: "lm", createdAt: D(2024, 2, 1) });
      insertLocalAlbum(t.db, { id: "sel", backupSelection: 1, assetIds: ["L-mid"] });

      const { rows } = timelinePage(t.db, { limit: 100 });
      expect(rows.map((r) => r.remote_id ?? r.local_id)).toEqual(["r-new", "L-mid", "r-old"]);
    });
  });

  /**
   * Paging *up* the timeline, which is what lets the viewer open a window around
   * a photo instead of loading everything above it. Both shapes of the query
   * (remote-only and merged) have to behave identically here — the viewer does
   * not know which one it will get.
   */
  describe.each([
    ["remote fast path", false],
    ["merged path", true],
  ])("windowing — %s", (_label, withLocal) => {
    const IDS = Array.from({ length: 9 }, (_, i) => `p${i}`);

    beforeEach(() => {
      seedRemotePhotos(
        t.db,
        IDS.map((id, i) => remotePhoto({ id, imageHash: `h-${id}`, timestamp: D(2024, 1, 1) + i * 86400000 }))
      );
      if (withLocal) {
        // Forces the union shape without adding a row to the page under test:
        // this asset is backup-selected (so the merged query is chosen) but its
        // hash is already on the server, so the local arm absorbs it.
        insertLocalAsset(t.db, { id: "Lx", hash: "h-p0", createdAt: D(2024, 1, 1) });
        insertLocalAlbum(t.db, { id: "sel", backupSelection: 1, assetIds: ["Lx"] });
      }
    });

    it("reads a window centred on a photo in the middle", () => {
      const anchor = timelineCursorFor(t.db, "p4");
      const older = timelinePage(t.db, { limit: 3, cursor: anchor, direction: "older", inclusive: true });
      const newer = timelinePage(t.db, { limit: 3, cursor: anchor, direction: "newer" });

      expect(older.rows.map((r) => r.remote_id)).toEqual(["p4", "p3", "p2"]);
      // Newest-first, and it stops immediately above the anchor.
      expect(newer.rows.map((r) => r.remote_id)).toEqual(["p7", "p6", "p5"]);
    });

    it("walks all the way to the newest photo and stops there", () => {
      let cursor = timelineCursorFor(t.db, "p0");
      const seen: string[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const p = timelinePage(t.db, { limit: 4, cursor, direction: "newer" });
        // Each page arrives newest-first and each page is newer than the last,
        // which is exactly how the viewer prepends them to its window.
        seen.unshift(...p.rows.map((r) => r.remote_id as string));
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      expect(seen).toEqual(["p8", "p7", "p6", "p5", "p4", "p3", "p2", "p1"]);
      // Asking again from the top yields nothing — the end of the timeline.
      const top = timelineCursorFor(t.db, "p8");
      expect(timelinePage(t.db, { limit: 4, cursor: top, direction: "newer" }).rows).toHaveLength(0);
    });

    it("walks all the way to the oldest photo and stops there", () => {
      let cursor = timelineCursorFor(t.db, "p8");
      const seen: string[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const p = timelinePage(t.db, { limit: 4, cursor, direction: "older" });
        seen.push(...p.rows.map((r) => r.remote_id as string));
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      expect(seen).toEqual(["p7", "p6", "p5", "p4", "p3", "p2", "p1", "p0"]);
      const bottom = timelineCursorFor(t.db, "p0");
      expect(timelinePage(t.db, { limit: 4, cursor: bottom, direction: "older" }).rows).toHaveLength(0);
    });

    it("an inclusive page starts at the cursor row itself", () => {
      const anchor = timelineCursorFor(t.db, "p4");
      expect(
        timelinePage(t.db, { limit: 2, cursor: anchor, direction: "older", inclusive: true }).rows[0]
          .remote_id
      ).toBe("p4");
      expect(
        timelinePage(t.db, { limit: 2, cursor: anchor, direction: "older" }).rows[0].remote_id
      ).toBe("p3");
    });
  });

  describe("timelineCursorFor", () => {
    it("prefers the remote row for a camera-roll asset already on the server", () => {
      seedRemotePhotos(t.db, [remotePhoto({ id: "r1", imageHash: "shared", timestamp: D(2024, 2, 2) })]);
      insertLocalAsset(t.db, { id: "L2", hash: "shared", createdAt: D(2024, 2, 2) });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L2"] });

      // The timeline row for this photo is the remote one (the local arm
      // excludes it), so the anchor has to be the remote key or the window
      // would be centred on a row that is not in it.
      expect(timelineCursorFor(t.db, "L2")).toEqual({ timestamp: D(2024, 2, 2), sortId: "r1" });
      expect(timelineCursorFor(t.db, "shared")?.sortId).toBe("r1");
    });

    it("anchors an unhashed camera-roll asset on its own row", () => {
      insertLocalAsset(t.db, { id: "L9", hash: null, createdAt: D(2024, 5, 5) });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L9"] });
      expect(timelineCursorFor(t.db, "L9")).toEqual({ timestamp: D(2024, 5, 5), sortId: "L9" });
    });

    it("is null for a photo that is not in the visible timeline", () => {
      seedRemotePhotos(t.db, [remotePhoto({ id: "hid", imageHash: "hh", timestamp: D(2024, 1, 1), hidden: true })]);
      expect(timelineCursorFor(t.db, "hid")).toBeNull();
      expect(timelineCursorFor(t.db, "ghost")).toBeNull();
    });
  });
});
