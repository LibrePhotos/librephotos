/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedAll, seedPhotos, type SeedSource } from "../remote/seed";
import { getSyncState } from "@/db/queries/sync-state";
import { filterPhotos } from "@/db/queries/filters";

type Item = {
  id: string;
  image_hash: string;
  aspectRatio: number;
  type: string;
  rating: number;
  date: string | null;
};

const item = (id: string, rating = 0, date: string | null = "2024-01-02T10:00:00"): Item => ({
  id,
  image_hash: `hash-${id}`,
  aspectRatio: 1,
  type: "image",
  rating,
  date,
});

/** A fake source with two timeline buckets, one hidden bucket, and small lists. */
function makeSource(overrides: Partial<SeedSource> = {}): SeedSource {
  const bucketItems: Record<string, Item[]> = {
    b1: [item("p1", 5), item("p2", 0)],
    b2: [item("p3", 0)],
    h1: [item("p4", 0)],
  };
  const listFor = (name: string, count: number) => ({
    id: name,
    date: "2024-01-02",
    location: null,
    items: [],
    incomplete: true,
    numberOfItems: count,
  });
  return {
    dateAlbumsList: async (filter) => {
      if (filter.hidden) return [listFor("h1", 1)] as never;
      if (filter.in_trashcan) return [];
      return [listFor("b1", 2), listFor("b2", 1)] as never;
    },
    dateAlbum: async (id, page) => {
      const items = page === 1 ? (bucketItems[id] ?? []) : [];
      return { id, date: "2024-01-02", location: null, items, incomplete: false, numberOfItems: items.length } as never;
    },
    photosWithoutTimestamp: async () => ({ results: [], next: null }),
    people: async () => [{ id: 1, name: "Ann", face_url: null, face_count: 3, face_photo_url: null, cover_photo: "h1" }] as never,
    userAlbumsList: async () => [] as never,
    userAlbum: async () => ({ grouped_photos: [] }) as never,
    autoAlbumsList: async () => [] as never,
    autoAlbum: async () => ({ photos: [] }) as never,
    thingAlbumsList: async () => [],
    placeAlbumsList: async () => [],
    tagAlbumsList: async () => [],
    ...overrides,
  };
}

const OPTS = { ownerId: 1, favoriteMinRating: 4, now: Date.UTC(2024, 5, 1) };

describe("seeder", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("seeds all photos across passes and materializes is_favorite", async () => {
    const written = await seedPhotos(t.db, makeSource(), OPTS);
    expect(written).toBe(4); // p1,p2,p3 (timeline) + p4 (hidden)
    const count = t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number };
    expect(count.c).toBe(4);
    // rating 5 >= favoriteMinRating 4 => favorite; rating 0 => not.
    expect(filterPhotos(t.db, "favorites").map((r) => r.id)).toEqual(["p1"]);
    // hidden pass set the flag.
    expect(filterPhotos(t.db, "hidden").map((r) => r.id)).toEqual(["p4"]);
  });

  it("is idempotent: re-seeding converges without duplicates", async () => {
    await seedPhotos(t.db, makeSource(), OPTS);
    await seedPhotos(t.db, makeSource(), OPTS);
    const count = t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number };
    expect(count.c).toBe(4);
  });

  it("records determinate progress + done status in sync_state", async () => {
    const events: number[] = [];
    await seedPhotos(t.db, makeSource(), { ...OPTS, onProgress: (p) => events.push(p.current) });
    const state = getSyncState(t.db, "photo");
    expect(state?.status).toBe("done");
    expect(state?.progress_total).toBeGreaterThanOrEqual(3);
    expect(events[events.length - 1]).toBeGreaterThan(0);
  });

  it("resumes an interrupted seed: only un-ingested buckets are re-fetched", async () => {
    const fetched: string[] = [];
    const bucketItems = (id: string): Item[] =>
      id === "b1" ? [item("p1", 5), item("p2")] : id === "b2" ? [item("p3")] : [item("p4")];

    // First run fails while fetching b2 — b1 is ingested and recorded, status
    // stays "running" (interrupted).
    const failing = makeSource({
      dateAlbum: async (id, page) => {
        fetched.push(id);
        if (id === "b2") throw new Error("network drop");
        const items = page === 1 ? bucketItems(id) : [];
        return { id, date: "2024-01-02", location: null, items, incomplete: false, numberOfItems: items.length } as never;
      },
    });
    await expect(seedPhotos(t.db, failing, OPTS)).rejects.toThrow("network drop");
    expect(getSyncState(t.db, "photo")?.status).toBe("running");
    expect(fetched).toContain("b1");

    // Resume: b1 is recorded done and must NOT be re-fetched; b2 onward is.
    fetched.length = 0;
    const ok = makeSource({
      dateAlbum: async (id, page) => {
        fetched.push(id);
        const items = page === 1 ? bucketItems(id) : [];
        return { id, date: "2024-01-02", location: null, items, incomplete: false, numberOfItems: items.length } as never;
      },
    });
    await seedPhotos(t.db, ok, OPTS);
    expect(fetched).not.toContain("b1");
    expect(fetched).toContain("b2");
    const count = t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number };
    expect(count.c).toBe(4);
  });

  it("seedAll returns per-entity counts and marks all entities done", async () => {
    const res = await seedAll(t.db, makeSource(), OPTS);
    expect(res.photos).toBe(4);
    expect(res.people).toBe(1);
    expect(getSyncState(t.db, "person")?.status).toBe("done");
    expect(getSyncState(t.db, "thing_album")?.status).toBe("done");
  });
});
