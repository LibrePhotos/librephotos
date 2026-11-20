/**
 * @jest-environment node
 *
 * The archive (#545) and media-category flags outside the timeline: the
 * Archive / Screenshots / Documents flag screens and their Collections counts,
 * the screens that keep archived photos (as the web does), Memories (which,
 * like the web's, leaves archived photos, screenshots and documents out), and
 * the migration that re-pulls photos so an old mirror learns the flags.
 */
import { createTestDb, type TestDb } from "../testing";
import { filterCounts, filterPhotos, type PhotoFilter } from "../queries/filters";
import { onThisDay } from "../queries/memories";
import { remotePhoto, seedRemotePhotos } from "../fixtures";

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
  beforeEach(async () => {
    t = createTestDb();
    await seedRemotePhotos(t.db, [
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

  const listed = async (f: PhotoFilter) => (await filterPhotos(t.db, f)).map((r) => r.id);

  it("archived: the archived photos that are not hidden, trashed or removed", async () => {
    expect(await listed("archived")).toEqual(["arch", "archfav", "archvid", "archshot", "archnots"]);
  });

  it("screenshots and documents: the flag, visible and not archived", async () => {
    expect(await listed("screenshots")).toEqual(["shot"]);
    expect(await listed("documents")).toEqual(["doc"]);
  });

  it("keeps archived photos in favorites, videos, recent and no-timestamp (as the web)", async () => {
    expect(await listed("favorites")).toContain("archfav");
    expect(await listed("videos")).toContain("archvid");
    expect(await listed("recent")).toContain("arch");
    expect(await listed("notimestamp")).toEqual(["archnots"]);
  });

  it("counts every filter, matching the lists", async () => {
    const counts = await filterCounts(t.db, ALL_FILTERS);
    for (const f of ALL_FILTERS) expect([f, counts[f]]).toEqual([f, (await listed(f)).length]);
    expect(counts.archived).toBe(5);
    expect(counts.screenshots).toBe(1);
    expect(counts.documents).toBe(1);
  });

  it("leaves the counts it was not asked for at zero", async () => {
    const counts = await filterCounts(t.db, ["archived"]);
    expect(counts.archived).toBe(5);
    expect(counts.screenshots).toBe(0);
  });
});

describe("memories leave archived photos, screenshots and documents out", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("keeps only the plain photo", async () => {
    const jun15 = (year: number) => Date.UTC(year, 5, 15, 12);
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "plain", timestamp: jun15(2021) }),
      remotePhoto({ id: "arch", timestamp: jun15(2022), archived: true }),
      remotePhoto({ id: "shot", timestamp: jun15(2022), isScreenshot: true }),
      remotePhoto({ id: "doc", timestamp: jun15(2023), isDocument: true }),
    ]);
    const res = await onThisDay(t.db, { today: new Date(2025, 5, 15, 12) });
    expect(res.map((m) => m.id)).toEqual(["plain"]);
  });
});
