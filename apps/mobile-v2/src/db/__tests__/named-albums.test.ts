import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../test-db";
import {
  firstCoverHash,
  placeAlbumsList,
  tagAlbumsList,
  thingAlbumsList,
} from "../queries/albums";

describe("named album (thing/place/tag) list mirrors", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("firstCoverHash parses the first hash of a JSON array", () => {
    expect(firstCoverHash(JSON.stringify(["h1", "h2"]))).toBe("h1");
    expect(firstCoverHash(JSON.stringify([]))).toBeNull();
    expect(firstCoverHash(null)).toBeNull();
    expect(firstCoverHash("not json")).toBeNull();
  });

  it("lists thing albums ordered by photo_count desc", () => {
    t.db.run(
      sql`INSERT INTO thing_album (id, title, photo_count, cover_hashes, last_modified) VALUES
          (1, 'Dog', 5, ${JSON.stringify(["dog-cover"])}, 100),
          (2, 'Cat', 20, ${JSON.stringify(["cat-cover"])}, 100)`
    );
    const rows = thingAlbumsList(t.db);
    expect(rows.map((r) => r.title)).toEqual(["Cat", "Dog"]);
    expect(firstCoverHash(rows[0]!.cover_hashes)).toBe("cat-cover");
  });

  it("lists place albums", () => {
    t.db.run(
      sql`INSERT INTO place_album (id, title, photo_count, cover_hashes, geolocation_level, last_modified)
          VALUES (3, 'Berlin', 8, ${JSON.stringify(["b"])}, 1, 100)`
    );
    const rows = placeAlbumsList(t.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Berlin");
  });

  it("lists tag albums", () => {
    t.db.run(
      sql`INSERT INTO tag_album (id, title, photo_count, cover_hashes, last_modified)
          VALUES (7, 'sunset', 3, ${JSON.stringify(["s"])}, 100)`
    );
    const rows = tagAlbumsList(t.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("sunset");
  });
});
