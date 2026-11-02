/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from "../test-db";
import { upsertUserAlbums } from "../writers";
import { userAlbumExplicitCover, userAlbums } from "../queries/albums";
import { remotePhoto, seedRemotePhotos } from "./fixtures";
import { USER_ALBUM_SORTS, isUserAlbumSort } from "@/lib/albumSort";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

type AlbumSeed = {
  id: number;
  title: string;
  coverHash?: string | null;
  photoCount?: number;
  createdOn?: number | null;
  lastModified?: number | null;
  favorited?: boolean;
  photoIds?: string[];
};

function seedAlbums(t: TestDb, albums: AlbumSeed[]): void {
  upsertUserAlbums(
    t.db,
    albums.map((a) => ({
      id: a.id,
      title: a.title,
      ownerId: 1,
      shared: false,
      favorited: a.favorited ?? false,
      coverHash: a.coverHash ?? null,
      photoCount: a.photoCount ?? a.photoIds?.length ?? 0,
      createdOn: a.createdOn ?? null,
      lastModified: a.lastModified ?? null,
      photoIds: a.photoIds ?? [],
    }))
  );
}

describe("userAlbums cover fallback", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "old", imageHash: "h-old", timestamp: D(2020, 1, 1) }),
      remotePhoto({ id: "new", imageHash: "h-new", timestamp: D(2024, 1, 1) }),
      remotePhoto({ id: "newest-hidden", imageHash: "h-hidden", timestamp: D(2025, 1, 1), hidden: true }),
      remotePhoto({ id: "newest-trashed", imageHash: "h-trashed", timestamp: D(2025, 2, 1), inTrashcan: true }),
    ]);
  });
  afterEach(() => t.close());

  it("keeps an explicit cover", () => {
    seedAlbums(t, [{ id: 1, title: "A", coverHash: "h-old", photoIds: ["old", "new"] }]);
    expect(userAlbums(t.db)[0]?.cover_hash).toBe("h-old");
  });

  it("falls back to the newest visible photo of the album", () => {
    seedAlbums(t, [{ id: 1, title: "A", photoIds: ["old", "new", "newest-hidden", "newest-trashed"] }]);
    expect(userAlbums(t.db)[0]?.cover_hash).toBe("h-new");
    // The explicit-cover lookup still says "automatic".
    expect(userAlbumExplicitCover(t.db, 1)).toBeNull();
  });

  it("an empty album has no cover", () => {
    seedAlbums(t, [{ id: 1, title: "Empty" }]);
    expect(userAlbums(t.db)[0]?.cover_hash).toBeNull();
  });
});

describe("userAlbums sort", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedAlbums(t, [
      { id: 1, title: "beach", photoCount: 5, createdOn: D(2022, 1, 1), lastModified: D(2024, 6, 1) },
      { id: 2, title: "Alps", photoCount: 20, createdOn: D(2024, 1, 1), lastModified: D(2023, 1, 1), favorited: true },
      { id: 3, title: "City", photoCount: 1, createdOn: null, lastModified: D(2025, 1, 1) },
    ]);
  });
  afterEach(() => t.close());

  const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

  it("defaults to favorites first, then newest created", () => {
    expect(titles(userAlbums(t.db))).toEqual(["Alps", "beach", "City"]);
  });

  it("sorts by name, case-insensitively", () => {
    expect(titles(userAlbums(t.db, "name"))).toEqual(["Alps", "beach", "City"]);
  });

  it("sorts by created date both ways, undated last", () => {
    expect(titles(userAlbums(t.db, "created_desc"))).toEqual(["Alps", "beach", "City"]);
    expect(titles(userAlbums(t.db, "created_asc"))).toEqual(["beach", "Alps", "City"]);
  });

  it("sorts by photo count and by last update", () => {
    expect(titles(userAlbums(t.db, "count_desc"))).toEqual(["Alps", "beach", "City"]);
    expect(titles(userAlbums(t.db, "updated_desc"))).toEqual(["City", "beach", "Alps"]);
  });

  it("validates a persisted sort value", () => {
    for (const sort of USER_ALBUM_SORTS) expect(isUserAlbumSort(sort)).toBe(true);
    expect(isUserAlbumSort("date")).toBe(false);
    expect(isUserAlbumSort(3)).toBe(false);
  });
});
