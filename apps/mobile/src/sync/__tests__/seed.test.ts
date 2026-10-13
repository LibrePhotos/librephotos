/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { Media, type IncompleteDatePhotosGroup, type PigPhoto } from "@librephotos/api-client";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedAll, seedPeople, seedPhotos, type SeedSource } from "../remote/seed";
import { getSyncState } from "@/db/queries/sync-state";
import { filterPhotos } from "@/db/queries/filters";
import { pullEntity } from "../remote/delta";
import { syncPersonToRow } from "../remote/mappers";
import { FakeSource, emptyStore, personItem } from "./fake-source";

const item = (id: string, rating = 0, date: string | null = "2024-01-02T10:00:00"): PigPhoto => ({
  id,
  image_hash: `hash-${id}`,
  aspectRatio: 1,
  type: Media.IMAGE,
  rating,
  date,
  is_hdr: false,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

/** Date album ids of the fixture's buckets: two on the timeline, one hidden. */
const B1 = 1;
const B2 = 2;
const H1 = 3;

/** One date bucket as the paginated date-album endpoints return it. */
function bucket(id: number, items: PigPhoto[], numberOfItems: number, incomplete: boolean): IncompleteDatePhotosGroup {
  return { id, date: "2024-01-02", location: null, items, incomplete, numberOfItems };
}

/** The lists here are empty, so the seeder never asks for one album's detail. */
function noAlbum(id: number): Promise<never> {
  return Promise.reject(new Error(`album ${id} is not in this fixture`));
}

/** A fake source with two timeline buckets, one hidden bucket, and small lists. */
function makeSource(overrides: Partial<SeedSource> = {}): SeedSource {
  const bucketItems: Record<number, PigPhoto[]> = {
    [B1]: [item("p1", 5), item("p2", 0)],
    [B2]: [item("p3", 0)],
    [H1]: [item("p4", 0)],
  };
  return {
    dateAlbumsList: async (filter) => {
      if (filter.hidden) return [bucket(H1, [], 1, true)];
      if (filter.in_trashcan) return [];
      return [bucket(B1, [], 2, true), bucket(B2, [], 1, true)];
    },
    dateAlbum: async (id, page) => {
      const items = page === 1 ? (bucketItems[id] ?? []) : [];
      return bucket(id, items, items.length, false);
    },
    photosWithoutTimestamp: async () => ({ results: [], next: null }),
    // GET /api/persons/ as PersonSerializer sends it: the cover's hash is in
    // face_photo_url ("" for a person without faces); cover_photo is write-only.
    people: async () => [
      { id: 1, name: "Ann", face_url: "/media/faces/ann.jpg", face_count: 3, face_photo_url: "h1", video: false },
    ],
    userAlbumsList: async () => [],
    userAlbum: noAlbum,
    autoAlbumsList: async () => [],
    autoAlbum: noAlbum,
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
    const fetched: number[] = [];
    const bucketItems = (id: number): PigPhoto[] =>
      id === B1 ? [item("p1", 5), item("p2")] : id === B2 ? [item("p3")] : [item("p4")];

    // First run fails while fetching b2 — b1 is ingested and recorded, status
    // stays "running" (interrupted).
    const failing = makeSource({
      dateAlbum: async (id, page) => {
        fetched.push(id);
        if (id === B2) throw new Error("network drop");
        const items = page === 1 ? bucketItems(id) : [];
        return bucket(id, items, items.length, false);
      },
    });
    await expect(seedPhotos(t.db, failing, OPTS)).rejects.toThrow("network drop");
    expect(getSyncState(t.db, "photo")?.status).toBe("running");
    expect(fetched).toContain(B1);

    // Resume: b1 is recorded done and must NOT be re-fetched; b2 onward is.
    fetched.length = 0;
    const ok = makeSource({
      dateAlbum: async (id, page) => {
        fetched.push(id);
        const items = page === 1 ? bucketItems(id) : [];
        return bucket(id, items, items.length, false);
      },
    });
    await seedPhotos(t.db, ok, OPTS);
    expect(fetched).not.toContain(B1);
    expect(fetched).toContain(B2);
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

  it("seeds a person's cover from face_photo_url, the field the server sends", async () => {
    const source = makeSource({
      people: async () => [
        { id: 1, name: "Ann", face_url: "/media/faces/ann.jpg", face_count: 3, face_photo_url: "h1", video: false },
        { id: 2, name: "Bob", face_url: "", face_count: 0, face_photo_url: "", video: false },
      ],
    });
    expect(await seedPeople(t.db, source, OPTS.now)).toBe(2);
    const rows = t.db.all(sql`SELECT id, cover_photo_hash FROM person ORDER BY id`);
    expect(rows).toEqual([
      { id: 1, cover_photo_hash: "h1" },
      // No faces, no cover: "" is stored as null, like the delta sync's null.
      { id: 2, cover_photo_hash: null },
    ]);
  });

  it("keeps the first-face cover the seed stored when a delta pull updates the person", async () => {
    // The seed reads the People list, whose cover falls back to the first
    // face's photo. The delta feed's cover_photo_hash is the chosen cover only,
    // so writing it over the seed blanked Ann's cover after the first pull.
    await seedPeople(t.db, makeSource(), OPTS.now);
    const store = emptyStore();
    store.person = [
      personItem(1, {
        name: "Ann",
        face_count: 4,
        cover_photo_hash: null,
        effective_cover_hash: "h1",
        last_modified: OPTS.now + 1,
      }),
    ];
    await pullEntity(t.db, new FakeSource(store), "person");
    expect(t.db.get(sql`SELECT face_count, cover_photo_hash FROM person WHERE id = 1`)).toEqual({
      face_count: 4,
      cover_photo_hash: "h1",
    });
  });

  it("reads the chosen cover from a server that sends no effective cover", () => {
    // Servers up to 1.3.0 send only cover_photo_hash.
    expect(syncPersonToRow(personItem(1, { cover_photo_hash: "chosen" })).coverPhotoHash).toBe("chosen");
    expect(
      syncPersonToRow(personItem(1, { cover_photo_hash: null, effective_cover_hash: null })).coverPhotoHash,
    ).toBeNull();
  });
});
