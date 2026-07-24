/**
 * @jest-environment node
 *
 * Performance budget (doc 02 §5): the hot read queries must be index-covered at
 * 100k rows — no full table scan of remote_photo. Asserted via EXPLAIN QUERY
 * PLAN against a seeded 100k-row fixture.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import { explainTimelineBuckets, explainTimelinePage, timelinePage } from "../queries/timeline";
import { explainFilter, filterPhotos } from "../queries/filters";
import { remotePhoto, seedRemotePhotos } from "./fixtures";
import type { RemotePhotoInput } from "../writers";

const N = 100_000;
const DAY = 86_400_000;
const START = Date.UTC(2015, 0, 1);

function plansText(rows: { detail: string }[]): string {
  return rows.map((r) => r.detail).join("\n");
}

describe("EXPLAIN QUERY PLAN budget (100k rows)", () => {
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
    const rows: RemotePhotoInput[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const ts = START + i * (DAY / 8); // ~8 photos/day across ~34 years
      rows[i] = remotePhoto({
        id: `p${String(i).padStart(7, "0")}`,
        imageHash: `h${i}`,
        timestamp: ts,
        rating: i % 50 === 0 ? 5 : 0,
        isFavorite: i % 50 === 0,
        type: i % 10 === 0 ? "video" : "image",
      });
    }
    seedRemotePhotos(t.db, rows);
    t.sqlite.exec("ANALYZE");
  });

  afterAll(() => t?.close());

  it("seeded 100k rows", () => {
    const c = t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number };
    expect(c.c).toBe(N);
  });

  it("timeline page uses the covering visible index, no temp sort", () => {
    const text = plansText(explainTimelinePage(t.db));
    expect(text).toMatch(/USING INDEX idx_remote_photo_visible/);
    // Keyset order comes from the index — no full scan and no temp b-tree sort.
    expect(text).not.toMatch(/SCAN remote_photo\b(?!.*USING INDEX)/);
    expect(text).not.toMatch(/USE TEMP B-TREE/);
  });

  it("bucket query is index-covered (no unindexed full scan)", () => {
    const text = plansText(explainTimelineBuckets(t.db));
    expect(text).toMatch(/USING INDEX idx_remote_photo/);
    expect(text).not.toMatch(/SCAN remote_photo\b(?!.*USING INDEX)/);
  });

  it("favorites filter uses the partial favorite index", () => {
    const text = plansText(explainFilter(t.db, "favorites"));
    expect(text).toMatch(/USING INDEX idx_remote_photo_favorite/);
    expect(text).not.toMatch(/\bSCAN remote_photo\b(?!.*USING INDEX)/);
  });

  it("hidden + deleted filters use their partial indexes", () => {
    expect(plansText(explainFilter(t.db, "hidden"))).toMatch(/USING INDEX idx_remote_photo_hidden/);
    expect(plansText(explainFilter(t.db, "deleted"))).toMatch(/USING INDEX idx_remote_photo_trash/);
  });

  it("returns a correct first page fast", () => {
    const start = Date.now();
    const { rows, nextCursor } = timelinePage(t.db, { limit: 100 });
    const elapsed = Date.now() - start;
    expect(rows).toHaveLength(100);
    expect(nextCursor).not.toBeNull();
    // Newest first.
    expect(rows[0].timestamp!).toBeGreaterThan(rows[99].timestamp!);
    expect(elapsed).toBeLessThan(200);
  });

  it("favorites query returns only favorites", () => {
    const favs = filterPhotos(t.db, "favorites", { limit: 10 });
    expect(favs.every((r) => r.is_favorite === 1)).toBe(true);
  });
});
