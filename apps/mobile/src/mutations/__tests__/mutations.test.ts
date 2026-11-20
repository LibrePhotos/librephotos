/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";
import { setMetaNumber, META_FAVORITE_MIN_RATING } from "@librephotos/local-db";
import {
  favoritePhotos,
  hidePhotos,
  trashPhotos,
  archivePhotos,
  ratePhoto,
  captionPhoto,
  addPhotosToAlbum,
  removePhotosFromAlbum,
  createAlbum,
  renameAlbum,
  renamePerson,
  deleteAlbum,
  setAlbumCover,
} from "../actions";
import { enqueueOutbox, pendingOutboxCount, outboxSummary } from "../outbox";
import type { OutboxRow } from "../types";
import { defined } from "@/test/defined";

async function outboxRows(t: TestDb): Promise<OutboxRow[]> {
  return await t.db.all<OutboxRow>(sql`SELECT * FROM outbox ORDER BY id`);
}
async function photo(t: TestDb, hash: string) {
  return await t.db.get<{ is_favorite: number; hidden: number; in_trashcan: number; rating: number } | undefined>(sql`SELECT * FROM remote_photo WHERE image_hash = ${hash}`);
}

describe("mutation actions — optimistic write + outbox row", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await setMetaNumber(t.db, META_FAVORITE_MIN_RATING, 4);
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "hashA", rating: 0 }),
      remotePhoto({ id: "p2", imageHash: "hashB", rating: 0 }),
    ]);
  });
  afterEach(() => t.close());

  it("favorite flips is_favorite + rating and queues one row", async () => {
    const { outboxId } = await favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: true });
    expect(outboxId).toBeGreaterThan(0);
    expect(await photo(t, "hashA")).toMatchObject({ is_favorite: 1, rating: 4 });
    const rows = await outboxRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("favorite");
    expect(JSON.parse(defined(rows[0].payload))).toEqual({ imageHashes: ["hashA"], favorite: true });
  });

  it("unfavorite resets rating to 0", async () => {
    await favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: true });
    await favoritePhotos(t.db, { imageHashes: ["hashA"], favorite: false });
    expect(await photo(t, "hashA")).toMatchObject({ is_favorite: 0, rating: 0 });
  });

  it("hide + trash flip their flags and each queue a row", async () => {
    await hidePhotos(t.db, { imageHashes: ["hashA", "hashB"], hidden: true });
    await trashPhotos(t.db, { imageHashes: ["hashB"], deleted: true });
    expect(await photo(t, "hashA")).toMatchObject({ hidden: 1 });
    expect(await photo(t, "hashB")).toMatchObject({ hidden: 1, in_trashcan: 1 });
    expect(await pendingOutboxCount(t.db)).toBe(2);
  });

  it("archive flips the mirror's archived flag and queues a row", async () => {
    await archivePhotos(t.db, { imageHashes: ["hashA"], archived: true });
    expect(await t.db.get(sql`SELECT archived FROM remote_photo WHERE image_hash = 'hashA'`)).toEqual({ archived: 1 });
    const rows = await outboxRows(t);
    expect(rows.map((r) => r.kind)).toEqual(["archive"]);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ imageHashes: ["hashA"], archived: true });

    await archivePhotos(t.db, { imageHashes: ["hashA"], archived: false });
    expect(await t.db.get(sql`SELECT archived FROM remote_photo WHERE image_hash = 'hashA'`)).toEqual({ archived: 0 });
  });

  it("rating materializes is_favorite from the threshold", async () => {
    await ratePhoto(t.db, { imageHash: "hashA", rating: 5 });
    expect(await photo(t, "hashA")).toMatchObject({ rating: 5, is_favorite: 1 });
    await ratePhoto(t.db, { imageHash: "hashA", rating: 2 });
    expect(await photo(t, "hashA")).toMatchObject({ rating: 2, is_favorite: 0 });
  });

  it("caption patches a cached detail payload and queues a row", async () => {
    await t.db.run(
      sql`INSERT INTO remote_photo_detail (photo_id, payload, fetched_at)
          VALUES ('p1', ${JSON.stringify({ captions_json: { user_caption: "" } })}, 1)`
    );
    await captionPhoto(t.db, { imageHash: "hashA", caption: "Sunset" });
    const detail = await t.db.get<{ payload: string; }>(sql`SELECT payload FROM remote_photo_detail WHERE photo_id = 'p1'`);
    expect(JSON.parse(detail.payload)).toHaveProperty("captions_json.user_caption", "Sunset");
    expect(await pendingOutboxCount(t.db)).toBe(1);
  });

  it("caption works with no cached detail (queues only)", async () => {
    await captionPhoto(t.db, { imageHash: "hashB", caption: "Hi" });
    expect(await pendingOutboxCount(t.db)).toBe(1);
  });

  it("atomicity: a bad payload rolls back the optimistic write", async () => {
    // favorite with an empty hash list fails zod (min 1) → both must roll back.
    await expect(favoritePhotos(t.db, { imageHashes: [], favorite: true })).rejects.toThrow();
    expect(await pendingOutboxCount(t.db)).toBe(0);
    // hashA untouched.
    expect(await photo(t, "hashA")).toMatchObject({ is_favorite: 0 });
  });
});

describe("album + person mutations", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await seedRemotePhotos(t.db, [
      remotePhoto({ id: "pa", imageHash: "hA" }),
      remotePhoto({ id: "pb", imageHash: "hB" }),
    ]);
    await t.db.run(
      sql`INSERT INTO user_album (id, title, photo_count) VALUES (10, 'Trip', 0)`
    );
    await t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (5, 'Old', 3)`);
  });
  afterEach(() => t.close());

  it("add-to-album inserts membership and bumps photo_count", async () => {
    await addPhotosToAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa", "pb"], imageHashes: ["hA", "hB"] });
    const count = (await t.db.get<{ photo_count: number }>(sql`SELECT photo_count FROM user_album WHERE id = 10`)).photo_count;
    expect(count).toBe(2);
    const members = await t.db.all<{ photo_id: string }>(sql`SELECT photo_id FROM user_album_photo WHERE album_id = 10`);
    expect(members.map((m) => m.photo_id).sort()).toEqual(["pa", "pb"]);
  });

  it("remove-from-album deletes membership and decrements photo_count", async () => {
    await addPhotosToAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa", "pb"], imageHashes: ["hA", "hB"] });
    await removePhotosFromAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa"], imageHashes: ["hA"] });
    const count = (await t.db.get<{ photo_count: number }>(sql`SELECT photo_count FROM user_album WHERE id = 10`)).photo_count;
    expect(count).toBe(1);
  });

  it("create-album allocates a negative temp id + membership", async () => {
    const { tempId } = await createAlbum(t.db, { title: "New", photoIds: ["pa"], ownerId: 1 });
    expect(tempId).toBeLessThan(0);
    const album = await t.db.get<{ title: string; photo_count: number; }>(sql`SELECT title, photo_count FROM user_album WHERE id = ${tempId}`);
    expect(album).toMatchObject({ title: "New", photo_count: 1 });
    const rows = await t.db.all<{ kind: string; payload: string }>(sql`SELECT kind, payload FROM outbox`);
    expect(rows[0].kind).toBe("album_create");
    expect(JSON.parse(rows[0].payload)).toHaveProperty("tempId", tempId);
  });

  it("consecutive create-album temp ids never collide", async () => {
    const a = await createAlbum(t.db, { title: "A", photoIds: [] });
    const b = await createAlbum(t.db, { title: "B", photoIds: [] });
    expect(a.tempId).not.toBe(b.tempId);
  });

  it("rename-album + rename-person write optimistically and queue", async () => {
    await renameAlbum(t.db, { albumId: 10, title: "Trip 2024" });
    await renamePerson(t.db, { personId: 5, name: "New" });
    expect((await t.db.get<{ title: string }>(sql`SELECT title FROM user_album WHERE id = 10`)).title).toBe("Trip 2024");
    expect((await t.db.get<{ name: string }>(sql`SELECT name FROM person WHERE id = 5`)).name).toBe("New");
    expect(await pendingOutboxCount(t.db)).toBe(2);
  });

  it("delete-album drops the album + its membership (photos stay) and queues album_delete", async () => {
    await addPhotosToAlbum(t.db, { albumId: 10, title: "Trip", photoIds: ["pa", "pb"], imageHashes: ["hA", "hB"] });
    await deleteAlbum(t.db, { albumId: 10 });
    expect(await t.db.get(sql`SELECT id FROM user_album WHERE id = 10`)).toBeUndefined();
    expect(await t.db.all(sql`SELECT photo_id FROM user_album_photo WHERE album_id = 10`)).toEqual([]);
    expect(await t.db.all(sql`SELECT id FROM remote_photo ORDER BY id`)).toHaveLength(2);
    const last = (await outboxRows(t)).at(-1);
    expect(last?.kind).toBe("album_delete");
    expect(JSON.parse(defined(last?.payload ?? null))).toEqual({ albumId: 10 });
  });

  it("set-album-cover writes cover_hash and queues album_cover; null resets it", async () => {
    await setAlbumCover(t.db, { albumId: 10, photoId: "pb", imageHash: "hB" });
    const cover = async () => (await t.db.get<{ cover_hash: string | null }>(sql`SELECT cover_hash FROM user_album WHERE id = 10`)).cover_hash;
    expect(await cover()).toBe("hB");
    await setAlbumCover(t.db, { albumId: 10, photoId: null, imageHash: null });
    expect(await cover()).toBeNull();
    const rows = await outboxRows(t);
    expect(rows.map((r) => r.kind)).toEqual(["album_cover", "album_cover"]);
    expect(JSON.parse(defined(rows[0]?.payload ?? null))).toEqual({ albumId: 10, photoId: "pb", imageHash: "hB" });
  });
});

describe("outbox helpers", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("enqueueOutbox rejects a payload that fails its schema", async () => {
    // rating out of range.
    await expect(enqueueOutbox(t.db, "rating", { imageHash: "x", rating: 99 })).rejects.toThrow();
    expect(await pendingOutboxCount(t.db)).toBe(0);
  });

  it("outboxSummary groups by state", async () => {
    await enqueueOutbox(t.db, "favorite", { imageHashes: ["a"], favorite: true });
    const s = await outboxSummary(t.db);
    expect(s).toMatchObject({ pending: 1, total: 1 });
  });
});
