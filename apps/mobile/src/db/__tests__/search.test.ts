import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import { seedRemotePhotos, remotePhoto } from "./fixtures";
import {
  clearRecentSearches,
  datePrefixFor,
  getRecentSearches,
  offlineSearch,
  pushRecentSearch,
} from "../queries/search";

describe("offline search", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("datePrefixFor understands year / month / day terms", () => {
    expect(datePrefixFor("2024")).toBe("2024-%");
    expect(datePrefixFor("2024-6")).toBe("2024-06-%");
    expect(datePrefixFor("2024-06-5")).toBe("2024-06-05");
    expect(datePrefixFor("beach")).toBeNull();
  });

  it("matches photos by search_location", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", searchLocation: "Berlin, Germany" }),
      remotePhoto({ id: "p2", imageHash: "h2", searchLocation: "Paris, France" }),
    ]);
    const res = offlineSearch(t.db, "berlin");
    expect(res.photos.map((p) => p.image_hash)).toEqual(["h1"]);
  });

  it("matches photos by date term via bucket_day", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", timestamp: Date.UTC(2022, 5, 1) }),
      remotePhoto({ id: "p2", imageHash: "h2", timestamp: Date.UTC(2024, 5, 1) }),
    ]);
    const res = offlineSearch(t.db, "2024");
    expect(res.photos).toHaveLength(1);
    expect(res.photos[0]!.image_hash).toBe("h2");
  });

  it("matches people and albums by name/title", () => {
    t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Alice Smith', 10), (2, 'Bob', 2)`);
    t.db.run(
      sql`INSERT INTO user_album (id, title, shared, favorited, photo_count) VALUES (5, 'Alice Birthday', 0, 0, 3)`
    );
    t.db.run(sql`INSERT INTO thing_album (id, title, photo_count) VALUES (9, 'alice art', 1)`);
    const res = offlineSearch(t.db, "alice");
    expect(res.people.map((p) => p.name)).toEqual(["Alice Smith"]);
    expect(res.albums.map((a) => a.kind).sort()).toEqual(["thing", "user"]);
  });

  it("excludes hidden/trashed photos", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1", searchLocation: "Rome", hidden: true }),
      remotePhoto({ id: "p2", imageHash: "h2", searchLocation: "Rome", inTrashcan: true }),
      remotePhoto({ id: "p3", imageHash: "h3", searchLocation: "Rome" }),
    ]);
    const res = offlineSearch(t.db, "rome");
    expect(res.photos.map((p) => p.image_hash)).toEqual(["h3"]);
  });

  it("returns empty for a blank query", () => {
    const res = offlineSearch(t.db, "   ");
    expect(res).toEqual({ photos: [], people: [], albums: [] });
  });
});

describe("recent searches", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("pushes MRU-first, dedups case-insensitively, and caps at 8", () => {
    pushRecentSearch(t.db, "beach", 1);
    pushRecentSearch(t.db, "sunset", 2);
    pushRecentSearch(t.db, "Beach", 3); // dedup
    expect(getRecentSearches(t.db)).toEqual(["Beach", "sunset"]);

    for (let i = 0; i < 10; i++) pushRecentSearch(t.db, `term${i}`, 10 + i);
    expect(getRecentSearches(t.db)).toHaveLength(8);
    expect(getRecentSearches(t.db)[0]).toBe("term9");
  });

  it("clears recent searches", () => {
    pushRecentSearch(t.db, "x", 1);
    clearRecentSearches(t.db);
    expect(getRecentSearches(t.db)).toEqual([]);
  });
});
