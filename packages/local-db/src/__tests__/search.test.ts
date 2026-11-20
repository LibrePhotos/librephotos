import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../testing";
import { seedRemotePhotos, remotePhoto } from "../fixtures";
import {
  clearRecentSearches,
  datePrefixFor,
  getRecentSearches,
  offlineSearch,
  pushRecentSearch,
} from "../queries/search";
import { defined } from "./defined";

describe("offline search", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("datePrefixFor understands year / month / day terms", async () => {
    expect(datePrefixFor("2024")).toBe("2024-%");
    expect(datePrefixFor("2024-6")).toBe("2024-06-%");
    expect(datePrefixFor("2024-06-5")).toBe("2024-06-05");
    expect(datePrefixFor("beach")).toBeNull();
  });

  it("matches photos by search_location", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", searchLocation: "Berlin, Germany" }),
      remotePhoto({ id: "p2", imageHash: "h2", searchLocation: "Paris, France" }),
    ]);
    const res = await offlineSearch(t.db, "berlin");
    expect(res.photos.map((p) => p.image_hash)).toEqual(["h1"]);
  });

  it("matches photos by date term via bucket_day", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", timestamp: Date.UTC(2022, 5, 1) }),
      remotePhoto({ id: "p2", imageHash: "h2", timestamp: Date.UTC(2024, 5, 1) }),
    ]);
    const res = await offlineSearch(t.db, "2024");
    expect(res.photos).toHaveLength(1);
    expect(defined(res.photos[0]).image_hash).toBe("h2");
  });

  it("matches people and albums by name/title", async () => {
    await t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Alice Smith', 10), (2, 'Bob', 2)`);
    await t.db.run(
      sql`INSERT INTO user_album (id, title, shared, favorited, photo_count) VALUES (5, 'Alice Birthday', 0, 0, 3)`
    );
    await t.db.run(sql`INSERT INTO thing_album (id, title, photo_count) VALUES (9, 'alice art', 1)`);
    const res = await offlineSearch(t.db, "alice");
    expect(res.people.map((p) => p.name)).toEqual(["Alice Smith"]);
    expect(res.albums.map((a) => a.kind).sort()).toEqual(["thing", "user"]);
  });

  it("excludes hidden/trashed photos", async () => {
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", searchLocation: "Rome", hidden: true }),
      remotePhoto({ id: "p2", imageHash: "h2", searchLocation: "Rome", inTrashcan: true }),
      remotePhoto({ id: "p3", imageHash: "h3", searchLocation: "Rome" }),
    ]);
    const res = await offlineSearch(t.db, "rome");
    expect(res.photos.map((p) => p.image_hash)).toEqual(["h3"]);
  });

  it("returns empty for a blank query", async () => {
    const res = await offlineSearch(t.db, "   ");
    expect(res).toEqual({ photos: [], people: [], albums: [] });
  });
});

describe("recent searches", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("pushes MRU-first, dedups case-insensitively, and caps at 8", async () => {
    await pushRecentSearch(t.db, "beach", 1);
    await pushRecentSearch(t.db, "sunset", 2);
    await pushRecentSearch(t.db, "Beach", 3);
    expect(await getRecentSearches(t.db)).toEqual(["Beach", "sunset"]);

    for (let i = 0; i < 10; i++) (await pushRecentSearch(t.db, `term${i}`, 10 + i));
    expect(await getRecentSearches(t.db)).toHaveLength(8);
    expect((await getRecentSearches(t.db))[0]).toBe("term9");
  });

  it("clears recent searches", async () => {
    await pushRecentSearch(t.db, "x", 1);
    await clearRecentSearches(t.db);
    expect(await getRecentSearches(t.db)).toEqual([]);
  });
});
