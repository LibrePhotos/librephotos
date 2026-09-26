import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import { seedRemotePhotos, remotePhoto } from "./fixtures";
import { libraryStats } from "../queries/counts";

describe("libraryStats", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("counts visible photos/videos/favorites and albums/people", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h1" }),
      remotePhoto({ id: "p2", imageHash: "h2", isFavorite: true }),
      remotePhoto({ id: "v1", imageHash: "h3", type: "video" }),
      remotePhoto({ id: "t1", imageHash: "h4", inTrashcan: true }), // excluded
    ]);
    t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'A', 5), (2, 'B', 0)`);
    t.db.run(sql`INSERT INTO user_album (id, title, shared, favorited, photo_count) VALUES (1, 'Al', 0, 0, 2)`);
    t.db.run(sql`INSERT INTO place_album (id, title, photo_count) VALUES (1, 'Rome', 3)`);
    t.db.run(sql`INSERT INTO thing_album (id, title, photo_count) VALUES (1, 'Dog', 1)`);

    const stats = libraryStats(t.db);
    expect(stats.photos).toBe(2); // p1, p2 (video + trashed excluded)
    expect(stats.videos).toBe(1);
    expect(stats.favorites).toBe(1);
    expect(stats.people).toBe(1); // only face_count > 0
    expect(stats.albums).toBe(1);
    expect(stats.places).toBe(1);
    expect(stats.things).toBe(1);
  });
});
