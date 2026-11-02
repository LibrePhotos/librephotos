/**
 * @jest-environment node
 *
 * The archive (#545) and media-category flags outside the timeline: the
 * Archive / Screenshots / Documents flag screens and their Collections counts,
 * the screens that keep archived photos (as the web does), Memories (which,
 * like the web's, leaves archived photos, screenshots and documents out), and
 * the migration that re-pulls photos so an old mirror learns the flags.
 */
import { sql } from "drizzle-orm";
import Database from "better-sqlite3";
import { createTestDb, type TestDb } from "../test-db";
import { filterCounts, filterPhotos, type PhotoFilter } from "../queries/filters";
import { onThisDay } from "../queries/memories";
import { MIGRATION_STATEMENTS } from "../migrations-sql";
import { remotePhoto, seedRemotePhotos } from "./fixtures";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

const ALL_FILTERS: readonly PhotoFilter[] = [
  "favorites",
  "hidden",
  "deleted",
  "archived",
  "screenshots",
  "documents",
  "videos",
  "recent",
  "notimestamp",
];

describe("archive and category flag screens", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "plain", timestamp: D(2024, 1, 9) }),
      remotePhoto({ id: "arch", timestamp: D(2024, 1, 8), archived: true }),
      remotePhoto({ id: "archfav", timestamp: D(2024, 1, 7), archived: true, isFavorite: true, rating: 5 }),
      remotePhoto({ id: "archvid", timestamp: D(2024, 1, 6), archived: true, type: "video" }),
      remotePhoto({ id: "archnots", timestamp: null, addedOn: D(2024, 1, 5), archived: true }),
      remotePhoto({ id: "archhid", timestamp: D(2024, 1, 4), archived: true, hidden: true }),
      remotePhoto({ id: "archtrash", timestamp: D(2024, 1, 3), archived: true, inTrashcan: true }),
      remotePhoto({ id: "shot", timestamp: D(2024, 1, 2), isScreenshot: true }),
      remotePhoto({ id: "archshot", timestamp: D(2024, 1, 1), isScreenshot: true, archived: true }),
      remotePhoto({ id: "hidshot", timestamp: D(2023, 12, 31), isScreenshot: true, hidden: true }),
      remotePhoto({ id: "doc", timestamp: D(2023, 12, 30), isDocument: true }),
      remotePhoto({ id: "trashdoc", timestamp: D(2023, 12, 29), isDocument: true, inTrashcan: true }),
    ]);
  });
  afterEach(() => t.close());

  const listed = (f: PhotoFilter) => filterPhotos(t.db, f).map((r) => r.id);

  it("archived: the archived photos that are not hidden, trashed or removed", () => {
    expect(listed("archived")).toEqual(["arch", "archfav", "archvid", "archshot", "archnots"]);
  });

  it("screenshots and documents: the flag, visible and not archived", () => {
    expect(listed("screenshots")).toEqual(["shot"]);
    expect(listed("documents")).toEqual(["doc"]);
  });

  it("keeps archived photos in favorites, videos, recent and no-timestamp (as the web)", () => {
    expect(listed("favorites")).toContain("archfav");
    expect(listed("videos")).toContain("archvid");
    expect(listed("recent")).toContain("arch");
    expect(listed("notimestamp")).toEqual(["archnots"]);
  });

  it("counts every filter, matching the lists", () => {
    const counts = filterCounts(t.db, ALL_FILTERS);
    for (const f of ALL_FILTERS) expect([f, counts[f]]).toEqual([f, listed(f).length]);
    expect(counts.archived).toBe(5);
    expect(counts.screenshots).toBe(1);
    expect(counts.documents).toBe(1);
  });

  it("leaves the counts it was not asked for at zero", () => {
    const counts = filterCounts(t.db, ["archived"]);
    expect(counts.archived).toBe(5);
    expect(counts.screenshots).toBe(0);
  });
});

describe("memories leave archived photos, screenshots and documents out", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("keeps only the plain photo", () => {
    const jun15 = (year: number) => Date.UTC(year, 5, 15, 12);
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "plain", timestamp: jun15(2021) }),
      remotePhoto({ id: "arch", timestamp: jun15(2022), archived: true }),
      remotePhoto({ id: "shot", timestamp: jun15(2022), isScreenshot: true }),
      remotePhoto({ id: "doc", timestamp: jun15(2023), isDocument: true }),
    ]);
    const res = onThisDay(t.db, { today: new Date(2025, 5, 15, 12) });
    expect(res.map((m) => m.id)).toEqual(["plain"]);
  });
});

describe("migration 0008 (archive + category columns)", () => {
  const first = MIGRATION_STATEMENTS.findIndex((s) => s === "DROP INDEX `idx_remote_photo_visible`;");

  it("re-pulls photos from cursor zero and leaves the other feeds alone", () => {
    expect(first).toBeGreaterThan(0);
    const sqlite = new Database(":memory:");
    try {
      for (const stmt of MIGRATION_STATEMENTS.slice(0, first)) sqlite.exec(stmt);
      // A mirror seeded before the columns existed.
      sqlite.exec(
        `INSERT INTO remote_photo (id, image_hash, owner_id, timestamp, added_on, last_modified, type,
                                   bucket_day, bucket_month)
         VALUES ('p1', 'h1', 1, 1, 1, 1, 'image', '2024-01-01', '2024-01')`
      );
      sqlite.exec(
        `INSERT INTO sync_state (entity, cursor_modified, cursor_id, last_full_sync, status, progress_current, progress_total)
         VALUES ('photo', 5, 'tok-photo', 9, 'done', 10, 10), ('person', 6, 'tok-person', 9, 'done', 3, 3)`
      );

      for (const stmt of MIGRATION_STATEMENTS.slice(first)) sqlite.exec(stmt);

      const state = sqlite
        .prepare("SELECT entity, cursor_id, cursor_modified, status, progress_current FROM sync_state ORDER BY entity")
        .all();
      expect(state).toEqual([
        { entity: "person", cursor_id: "tok-person", cursor_modified: 6, status: "done", progress_current: 3 },
        { entity: "photo", cursor_id: null, cursor_modified: null, status: "idle", progress_current: 0 },
      ]);
      // The rows stay (the UI keeps showing them) with the new flags off until the pull.
      expect(
        sqlite.prepare("SELECT id, archived, is_screenshot, is_document FROM remote_photo").all()
      ).toEqual([{ id: "p1", archived: 0, is_screenshot: 0, is_document: 0 }]);
    } finally {
      sqlite.close();
    }
  });

  it("is a no-op for the sync state of a fresh install", () => {
    const t = createTestDb();
    try {
      const row = t.db.get(sql`SELECT COUNT(*) AS c FROM sync_state`) as { c: number };
      expect(row.c).toBe(0);
    } finally {
      t.close();
    }
  });
});
