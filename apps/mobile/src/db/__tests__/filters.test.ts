/**
 * @jest-environment node
 */
import { createTestDb, type TestDb } from "../test-db";
import { filterPhotos } from "../queries/filters";
import { userAlbums, userAlbumPhotos, autoAlbums } from "../queries/albums";
import { people } from "../queries/people";
import { remotePhoto, seedRemotePhotos } from "./fixtures";
import { upsertAutoAlbums, upsertPersons, upsertUserAlbums } from "../writers";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("flag filters", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "fav1", timestamp: D(2024, 1, 5), rating: 5, isFavorite: true }),
      remotePhoto({ id: "fav2", timestamp: D(2024, 1, 4), rating: 4, isFavorite: true }),
      remotePhoto({ id: "plain", timestamp: D(2024, 1, 3), rating: 0 }),
      remotePhoto({ id: "vid", timestamp: D(2024, 1, 2), type: "video" }),
      remotePhoto({ id: "hid", timestamp: D(2024, 1, 6), hidden: true }),
      remotePhoto({ id: "trash", timestamp: D(2024, 1, 7), inTrashcan: true }),
      remotePhoto({ id: "nots", timestamp: null, addedOn: D(2024, 1, 8) }),
      remotePhoto({ id: "recent", timestamp: D(2020, 1, 1), addedOn: D(2024, 6, 1) }),
    ]);
  });
  afterEach(() => t.close());

  it("favorites: only is_favorite, visible, timestamped, newest-first", () => {
    expect(filterPhotos(t.db, "favorites").map((r) => r.id)).toEqual(["fav1", "fav2"]);
  });

  it("hidden: only hidden rows", () => {
    expect(filterPhotos(t.db, "hidden").map((r) => r.id)).toEqual(["hid"]);
  });

  it("deleted: only in_trashcan rows", () => {
    expect(filterPhotos(t.db, "deleted").map((r) => r.id)).toEqual(["trash"]);
  });

  it("videos: only video type, visible", () => {
    expect(filterPhotos(t.db, "videos").map((r) => r.id)).toEqual(["vid"]);
  });

  it("notimestamp: only null-timestamp visible rows", () => {
    expect(filterPhotos(t.db, "notimestamp").map((r) => r.id)).toEqual(["nots"]);
  });

  it("recent: visible rows ordered by added_on desc", () => {
    const ids = filterPhotos(t.db, "recent", { limit: 3 }).map((r) => r.id);
    expect(ids[0]).toBe("recent"); // most-recently added despite old timestamp
  });
});

describe("album + people queries", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", timestamp: D(2024, 1, 2) }),
      remotePhoto({ id: "p2", timestamp: D(2024, 1, 1) }),
    ]);
  });
  afterEach(() => t.close());

  it("returns user albums with membership joined to remote_photo", () => {
    upsertUserAlbums(t.db, [
      {
        id: 1,
        title: "Trip",
        ownerId: 1,
        shared: false,
        favorited: true,
        coverHash: "hash-p1",
        photoCount: 2,
        createdOn: D(2024, 1, 1),
        lastModified: D(2024, 1, 1),
        photoIds: ["p1", "p2"],
      },
    ]);
    expect(userAlbums(t.db).map((a) => a.title)).toEqual(["Trip"]);
    expect(userAlbumPhotos(t.db, 1).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("returns auto albums newest-first", () => {
    upsertAutoAlbums(t.db, [
      { id: 1, title: "Old", timestamp: D(2020, 1, 1), favorited: false, photoCount: 1, coverHash: null, lastModified: 0 },
      { id: 2, title: "New", timestamp: D(2024, 1, 1), favorited: false, photoCount: 1, coverHash: null, lastModified: 0 },
    ]);
    expect(autoAlbums(t.db).map((a) => a.title)).toEqual(["New", "Old"]);
  });

  it("lists people with faces, most-photographed first", () => {
    upsertPersons(t.db, [
      { id: 1, name: "Ann", kind: "USER", faceCount: 3, coverPhotoHash: "h1", lastModified: 0 },
      { id: 2, name: "Bob", kind: "USER", faceCount: 10, coverPhotoHash: "h2", lastModified: 0 },
      { id: 3, name: "NoFaces", kind: "USER", faceCount: 0, coverPhotoHash: null, lastModified: 0 },
    ]);
    expect(people(t.db).map((p) => p.name)).toEqual(["Bob", "Ann"]);
  });
});
