/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { setMetaNumber, META_FAVORITE_MIN_RATING } from "@/db/queries/app-meta";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import {
  favoritePhotos,
  hidePhotos,
  trashPhotos,
  ratePhoto,
  captionPhoto,
  addPhotosToAlbum,
  removePhotosFromAlbum,
  createAlbum,
  renameAlbum,
  renamePerson,
} from "../actions";
import { enqueueOutbox, pendingOutboxCount, outboxSummary } from "../outbox";
import type { OutboxRow } from "../types";

function outboxRows(t: TestDb): OutboxRow[] {
  return t.db.all(sql`SELECT * FROM outbox ORDER BY id`) as OutboxRow[];
}
function photo(t: TestDb, hash: string) {
  return t.db.get(sql`SELECT * FROM remote_photo WHERE image_hash = ${hash}`) as
    | { is_favorite: number; hidden: number; in_trashcan: number; rating: number }
    | undefined;
}

describe("mutation actions — optimistic write + outbox row", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setMetaNumber(t.db, META_FAVORITE_MIN_RATING, 4);
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "hashA", rating: 0 }),
      remotePhoto({ id: "p2", imageHash: "hashB", rating: 0 }),
    ]);
  });
  afterEach(() => t.close());

  it("favorite flips is_favorite + rating and queues one row", () => {
    const { outboxId } = favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: true });
    expect(outboxId).toBeGreaterThan(0);
    expect(photo(t, "hashA")).toMatchObject({ is_favorite: 1, rating: 4 });
    const rows = outboxRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("favorite");
    expect(JSON.parse(rows[0].payload!)).toEqual({ imageHashes: ["hashA"], favorite: true });
  });

  it("unfavorite resets rating to 0", () => {
    favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: true });
    favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: false });
    expect(photo(t, "hashA")).toMatchObject({ is_favorite: 0, rating: 0 });
  });

  it("hide + trash flip their flags and each queue a row", () => {
    hidePhotos(t.db, { imageHashes: ["hashA", "hashB"], hidden: true });
    trashPhotos(t.db, { imageHashes: ["hashB"], deleted: true });
    expect(photo(t, "hashA")).toMatchObject({ hidden: 1 });
    expect(photo(t, "hashB")).toMatchObject({ hidden: 1, in_trashcan: 1 });
    expect(pendingOutboxCount(t.db)).toBe(2);
  });

  it("rating materializes is_favorite from the threshold", () => {
    ratePhoto(t.db, { imageHash: "hashA", rating: 5 });
    expect(photo(t, "hashA")).toMatchObject({ rating: 5, is_favorite: 1 });
    ratePhoto(t.db, { imageHash: "hashA", rating: 2 });
    expect(photo(t, "hashA")).toMatchObject({ rating: 2, is_favorite: 0 });
  });

  it("caption patches a cached detail payload and queues a row", () => {
    t.db.run(
      sql`INSERT INTO remote_photo_detail (photo_id, payload, fetched_at)
          VALUES ('p1', ${JSON.stringify({ captions_json: { user_caption: "" } })}, 1)`
    );
    captionPhoto(t.db, { imageHash: "hashA", caption: "Sunset" });
    const detail = t.db.get(sql`SELECT payload FROM remote_photo_detail WHERE photo_id = 'p1'`) as {
      payload: string;
    };
    expect(JSON.parse(detail.payload).captions_json.user_caption).toBe("Sunset");
    expect(pendingOutboxCount(t.db)).toBe(1);
  });

  it("caption works with no cached detail (queues only)", () => {
    captionPhoto(t.db, { imageHash: "hashB", caption: "Hi" });
    expect(pendingOutboxCount(t.db)).toBe(1);
  });

  it("atomicity: a bad payload rolls back the optimistic write", () => {
    // favorite with an empty hash list fails zod (min 1) → both must roll back.
    expect(() => favoritePhotos(t.db, { imageHashes: [], favorite: true })).toThrow();
    expect(pendingOutboxCount(t.db)).toBe(0);
    // hashA untouched.
    expect(photo(t, "hashA")).toMatchObject({ is_favorite: 0 });
  });
});

describe("album + person mutations", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "pa", imageHash: "hA" }),
      remotePhoto({ id: "pb", imageHash: "hB" }),
    ]);
    t.db.run(
      sql`INSERT INTO user_album (id, title, photo_count) VALUES (10, 'Trip', 0)`
    );
    t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (5, 'Old', 3)`);
  });
  afterEach(() => t.close());

  it("add-to-album inserts membership and bumps photo_count", () => {
    addPhotosToAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa", "pb"], imageHashes: ["hA", "hB"] });
    const count = (t.db.get(sql`SELECT photo_count FROM user_album WHERE id = 10`) as { photo_count: number }).photo_count;
    expect(count).toBe(2);
    const members = t.db.all(sql`SELECT photo_id FROM user_album_photo WHERE album_id = 10`) as { photo_id: string }[];
    expect(members.map((m) => m.photo_id).sort()).toEqual(["pa", "pb"]);
  });

  it("remove-from-album deletes membership and decrements photo_count", () => {
    addPhotosToAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa", "pb"], imageHashes: ["hA", "hB"] });
    removePhotosFromAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa"], imageHashes: ["hA"] });
    const count = (t.db.get(sql`SELECT photo_count FROM user_album WHERE id = 10`) as { photo_count: number }).photo_count;
    expect(count).toBe(1);
  });

  it("create-album allocates a negative temp id + membership", () => {
    const { tempId } = createAlbum(t.db, { title: "New", photoIds: ["pa"], ownerId: 1 });
    expect(tempId).toBeLessThan(0);
    const album = t.db.get(sql`SELECT title, photo_count FROM user_album WHERE id = ${tempId}`) as {
      title: string;
      photo_count: number;
    };
    expect(album).toMatchObject({ title: "New", photo_count: 1 });
    const rows = t.db.all(sql`SELECT kind, payload FROM outbox`) as { kind: string; payload: string }[];
    expect(rows[0].kind).toBe("album_create");
    expect(JSON.parse(rows[0].payload).tempId).toBe(tempId);
  });

  it("consecutive create-album temp ids never collide", () => {
    const a = createAlbum(t.db, { title: "A", photoIds: [] });
    const b = createAlbum(t.db, { title: "B", photoIds: [] });
    expect(a.tempId).not.toBe(b.tempId);
  });

  it("rename-album + rename-person write optimistically and queue", () => {
    renameAlbum(t.db, { albumId: 10, title: "Trip 2024" });
    renamePerson(t.db, { personId: 5, name: "New" });
    expect((t.db.get(sql`SELECT title FROM user_album WHERE id = 10`) as { title: string }).title).toBe("Trip 2024");
    expect((t.db.get(sql`SELECT name FROM person WHERE id = 5`) as { name: string }).name).toBe("New");
    expect(pendingOutboxCount(t.db)).toBe(2);
  });
});

describe("outbox helpers", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("enqueueOutbox rejects a payload that fails its schema", () => {
    // rating out of range.
    expect(() =>
      enqueueOutbox(t.db, "rating", { imageHash: "x", rating: 99 } as never)
    ).toThrow();
    expect(pendingOutboxCount(t.db)).toBe(0);
  });

  it("outboxSummary groups by state", () => {
    enqueueOutbox(t.db, "favorite", { imageHashes: ["a"], favorite: true });
    const s = outboxSummary(t.db);
    expect(s).toMatchObject({ pending: 1, total: 1 });
  });
});
