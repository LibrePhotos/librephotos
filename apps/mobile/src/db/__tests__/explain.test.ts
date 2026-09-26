/**
 * @jest-environment node
 *
 * Performance budget (doc 02 §5): the hot read queries must be index-covered at
 * 100k rows — no full table scan of remote_photo. Asserted via EXPLAIN QUERY
 * PLAN against a seeded 100k-row fixture.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import {
  explainMergedTimelinePage,
  explainMergedTimelineUnbounded,
  explainTimelineBuckets,
  explainTimelinePage,
  mergedTimelinePage,
  timelineCursorFor,
  timelinePage,
} from "../queries/timeline";
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

/**
 * The merged (remote UNION camera-roll) timeline at the size of a real phone.
 *
 * This is the query that made opening the viewer feel slow: its UNION arms had
 * no limit of their own, so SQLite materialised the entire library and sorted it
 * in a temp B-tree just to hand back the top N. Both arms are limited now, so
 * each one walks its index and stops; the only sort left is the bounded merge of
 * the two already-sorted arms.
 */
describe("EXPLAIN QUERY PLAN budget — merged timeline (20k remote + 20k camera roll)", () => {
  const REMOTE = 20_000;
  const LOCAL = 20_000;
  /** How many camera-roll assets are already on the server (join, not union). */
  const MATCHED = 10_000;
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
    const rows: RemotePhotoInput[] = new Array(REMOTE);
    for (let i = 0; i < REMOTE; i++) {
      rows[i] = remotePhoto({
        id: `p${String(i).padStart(7, "0")}`,
        imageHash: `h${i}`,
        timestamp: START + i * (DAY / 4),
      });
    }
    seedRemotePhotos(t.db, rows);

    const insert = t.sqlite.prepare(
      `INSERT INTO local_asset (id, name, type, created_at, modified_at, width, height, uri, hash, hashed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const link = t.sqlite.prepare(
      `INSERT INTO local_album_asset (album_id, asset_id) VALUES ('cam', ?)`
    );
    t.sqlite.exec(
      `INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
       VALUES ('cam', 'Camera Roll', ${LOCAL}, 0, 1)`
    );
    t.sqlite.transaction(() => {
      for (let i = 0; i < LOCAL; i++) {
        const id = `L${String(i).padStart(7, "0")}`;
        const ts = START + i * (DAY / 4) + 1000;
        insert.run(id, id, "image", ts, ts, 3000, 4000, `ph://${id}`, i < MATCHED ? `h${i}` : `lh${i}`, ts);
        link.run(id);
      }
    })();
    t.sqlite.exec("ANALYZE");
  });

  afterAll(() => t?.close());

  it("takes the merged path at all (both arms have rows)", () => {
    const { rows } = timelinePage(t.db, { limit: 40 });
    expect(rows).toHaveLength(40);
    expect(rows.some((r) => r.remote_id === null)).toBe(true); // camera-roll arm
    expect(rows.some((r) => r.local_id === null)).toBe(true); // server arm
  });

  it("drives BOTH union arms from an index and sorts only the merge", () => {
    const text = plansText(
      explainMergedTimelinePage(t.db, {
        limit: 41,
        cursor: { timestamp: START + 10_000 * (DAY / 4), sortId: "p0010000" },
      })
    );
    // Each arm walks its own key-ordered index and stops at its LIMIT.
    expect(text).toMatch(/SEARCH rp USING INDEX idx_remote_photo_visible/);
    expect(text).toMatch(/USING INDEX idx_local_asset_timeline/);
    // Neither base table is scanned end to end any more.
    expect(text).not.toMatch(/\bSCAN rp\b/);
    expect(text).not.toMatch(/\bSCAN la\b(?! USING INDEX)/);
    // Exactly one sort survives: the merge of the two arms, bounded by 2×limit
    // whatever the library size. (The arms themselves no longer sort.)
    expect(text.match(/USE TEMP B-TREE/g) ?? []).toHaveLength(1);
  });

  /** The shape that used to be on the viewer's critical path, kept honest. */
  it("the unbounded merged view is exactly what we stopped doing", () => {
    const text = plansText(explainMergedTimelineUnbounded(t.db));
    expect(text).toMatch(/\bSCAN rp\b/);
    expect(text).toMatch(/\bSCAN la\b/);
    expect(text).toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });

  it("reads a viewer-sized window around a photo in the middle of the library", () => {
    const anchor = timelineCursorFor(t.db, "p0010000");
    expect(anchor).not.toBeNull();

    const start = Date.now();
    const older = mergedTimelinePage(t.db, {
      limit: 21,
      cursor: anchor,
      direction: "older",
      inclusive: true,
    });
    const newer = mergedTimelinePage(t.db, { limit: 20, cursor: anchor, direction: "newer" });
    const elapsed = Date.now() - start;

    expect(older.rows).toHaveLength(21);
    expect(newer.rows).toHaveLength(20);
    // The anchor is the first of the "older" (inclusive) page…
    expect(older.rows[0].remote_id).toBe("p0010000");
    // …and the "newer" page is handed back newest-first and stops just above it.
    expect(newer.rows[19].timestamp!).toBeGreaterThan(older.rows[0].timestamp!);
    expect(newer.rows[0].timestamp!).toBeGreaterThan(newer.rows[19].timestamp!);
    // 41 slides out of 30k timeline rows, index-driven: nowhere near the ~40ms
    // the unbounded shape cost at this size.
    expect(elapsed).toBeLessThan(50);
  });

  it("resolves a cursor from a remote id, a hash and a camera-roll id", () => {
    expect(timelineCursorFor(t.db, "p0000005")?.sortId).toBe("p0000005");
    expect(timelineCursorFor(t.db, "h5")?.sortId).toBe("p0000005");
    // A camera-roll asset already on the server is represented by its remote row…
    expect(timelineCursorFor(t.db, "L0000005")?.sortId).toBe("p0000005");
    // …one that is not is its own timeline row.
    expect(timelineCursorFor(t.db, "L0015000")?.sortId).toBe("L0015000");
    expect(timelineCursorFor(t.db, "nope")).toBeNull();
  });
});
