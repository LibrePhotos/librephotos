/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from "@/db/test-db";
import {
  recordThumb,
  touchThumb,
  thumbCacheTotalBytes,
  lruCandidates,
  selectEvictions,
  getThumb,
  type ThumbRow,
} from "../thumbs";

describe("thumb cache LRU", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("records size and reports total bytes", () => {
    recordThumb(t.db, { photoId: "a", filePath: "/a", sizeBytes: 100, now: 1 });
    recordThumb(t.db, { photoId: "b", filePath: "/b", sizeBytes: 250, now: 2 });
    expect(thumbCacheTotalBytes(t.db)).toBe(350);
    expect(getThumb(t.db, "a")?.size_bytes).toBe(100);
  });

  it("orders LRU candidates oldest-first and touch bumps recency", () => {
    recordThumb(t.db, { photoId: "a", filePath: "/a", sizeBytes: 100, now: 1 });
    recordThumb(t.db, { photoId: "b", filePath: "/b", sizeBytes: 100, now: 2 });
    recordThumb(t.db, { photoId: "c", filePath: "/c", sizeBytes: 100, now: 3 });
    touchThumb(t.db, "a", 10); // a is now newest
    expect(lruCandidates(t.db).map((r) => r.photo_id)).toEqual(["b", "c", "a"]);
  });

  describe("selectEvictions policy", () => {
    const rows = (n: number): ThumbRow[] =>
      Array.from({ length: n }, (_, i) => ({
        photo_id: `p${i}`,
        file_path: `/p${i}`,
        size_bytes: 100,
        last_used: i, // p0 oldest
      }));

    it("evicts nothing when it already fits", () => {
      expect(selectEvictions(rows(3), 1000, 100)).toEqual([]);
    });

    it("evicts oldest-first until incoming fits under cap", () => {
      // total 300, cap 300, incoming 100 => must free 100 => evict p0.
      const victims = selectEvictions(rows(3), 300, 100);
      expect(victims.map((v) => v.photo_id)).toEqual(["p0"]);
    });

    it("evicts multiple oldest entries when needed", () => {
      // total 500, cap 300, incoming 100 => must free 300 => evict p0,p1,p2.
      const victims = selectEvictions(rows(5), 300, 100);
      expect(victims.map((v) => v.photo_id)).toEqual(["p0", "p1", "p2"]);
    });

    it("never evicts an id in the keep set", () => {
      const victims = selectEvictions(rows(3), 300, 100, new Set(["p0"]));
      expect(victims.map((v) => v.photo_id)).toEqual(["p1"]);
    });
  });
});
