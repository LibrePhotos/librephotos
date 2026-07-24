/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from "../test-db";
import { timelineBuckets, timelinePage } from "../queries/timeline";
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
});
