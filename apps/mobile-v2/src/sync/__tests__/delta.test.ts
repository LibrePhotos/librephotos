/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { getSyncState } from "@/db/queries/sync-state";
import { pullAll, pullEntity, SyncAbortedError } from "../remote/delta";
import {
  applyPhotosPage,
  applyUserAlbumsPage,
} from "../remote/applier";
import {
  FakeSource,
  emptyStore,
  photoItem,
  personItem,
  userAlbumItem,
  autoAlbumItem,
  encodeCursor,
} from "./fake-source";

function photoCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number }).c;
}

function photos(n: number, lm = 1000) {
  return Array.from({ length: n }, (_, i) => photoItem(`p${i + 1}`, { last_modified: lm + i }));
}

describe("delta pull loop", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("seeds all rows across keyset pages and records the durable cursor", async () => {
    const store = emptyStore();
    store.photo = photos(25);
    const source = new FakeSource(store);

    const res = await pullEntity(t.db, source, "photo", { pageSize: 4 });

    expect(res.applied).toBe(25);
    expect(res.seeded).toBe(true);
    expect(photoCount(t)).toBe(25);
    const state = getSyncState(t.db, "photo");
    expect(state?.status).toBe("done");
    // Durable cursor is the last item's keyset token.
    expect(state?.cursor_id).toBe(encodeCursor(1024, "p25"));
    // >1 page was needed (25 items / 4 per page).
    expect(source.calls.photo).toBeGreaterThan(1);
  });

  it("records the determinate total from the seed's first page", async () => {
    const store = emptyStore();
    store.photo = photos(7);
    const events: number[] = [];
    await pullEntity(t.db, new FakeSource(store), "photo", {
      pageSize: 2,
      onProgress: (p) => events.push(p.total),
    });
    expect(events[0]).toBe(7); // total known from page 1
  });

  it("delta: a second pull fetches only rows newer than the stored cursor", async () => {
    const store = emptyStore();
    store.photo = photos(5); // last_modified 1000..1004
    const source = new FakeSource(store);
    await pullEntity(t.db, source, "photo");
    expect(photoCount(t)).toBe(5);

    // Add a newer row; the delta must pull only it.
    store.photo.push(photoItem("p6", { last_modified: 2000 }));
    const before = source.calls.photo;
    const res = await pullEntity(t.db, source, "photo");
    expect(res.applied).toBe(1);
    expect(photoCount(t)).toBe(6);
    // The resume request used the stored cursor (didn't re-scan from zero).
    expect(source.calls.photo).toBeGreaterThan(before);
    expect(getSyncState(t.db, "photo")?.cursor_id).toBe(encodeCursor(2000, "p6"));
  });

  it("resumes mid-entity from the persisted cursor after an interruption", async () => {
    const store = emptyStore();
    store.photo = photos(10);

    // A source that throws on the 2nd fetch simulates a mid-seed crash.
    let n = 0;
    const flaky = new FakeSource(store);
    const origPhotos = flaky.photos.bind(flaky);
    flaky.photos = (p) => {
      n += 1;
      if (n === 2) return Promise.reject(new Error("network drop"));
      return origPhotos(p);
    };

    await expect(pullEntity(t.db, flaky, "photo", { pageSize: 3 })).rejects.toThrow("network drop");
    const partial = photoCount(t);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(10);
    expect(getSyncState(t.db, "photo")?.status).toBe("error");

    // Resume with a healthy source: completes without re-fetching page 1's rows.
    await pullEntity(t.db, new FakeSource(store), "photo", { pageSize: 3 });
    expect(photoCount(t)).toBe(10);
    expect(getSyncState(t.db, "photo")?.status).toBe("done");
  });

  it("applies tombstones on a cursored pull (deletes removed rows)", async () => {
    const store = emptyStore();
    store.photo = photos(3);
    // Seed with a plain source (tombstones surface only on cursored pulls).
    await pullEntity(t.db, new FakeSource(store), "photo");
    expect(photoCount(t)).toBe(3);

    // A later delta pull (starts from the stored cursor) carries the tombstone.
    const withTomb = new FakeSource(store, { tombstones: { photo: ["p2"] } });
    await pullEntity(t.db, withTomb, "photo");
    const ids = (t.db.all(sql`SELECT id FROM remote_photo ORDER BY id`) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["p1", "p3"]);
  });

  it("410 cursor_expired clears the entity and re-seeds from zero", async () => {
    const store = emptyStore();
    store.photo = photos(4);
    const source = new FakeSource(store);
    await pullEntity(t.db, source, "photo");
    expect(photoCount(t)).toBe(4);

    // Next run: the stored cursor is expired once, forcing a clean reseed.
    const expiring = new FakeSource(store, { expireOnce: { photo: true } });
    const res = await pullEntity(t.db, expiring, "photo");
    expect(res.seeded).toBe(true);
    expect(photoCount(t)).toBe(4);
    expect(getSyncState(t.db, "photo")?.status).toBe("done");
  });

  it("is idempotent: re-applying the same page converges without duplicates", async () => {
    const env = {
      v: 1 as const,
      items: [photoItem("p1"), photoItem("p2")],
      tombstones: [],
      next_cursor: null,
      server_time: "0",
    };
    // Need a sync_state row for the cursor UPDATE (no-op here since next=null).
    applyPhotosPage(t.db, env as never, Date.now());
    applyPhotosPage(t.db, env as never, Date.now());
    expect(photoCount(t)).toBe(2);
  });

  it("user-album membership is replaced from embedded photo_ids", async () => {
    const env = {
      v: 1 as const,
      items: [userAlbumItem(7, { photo_ids: ["a", "b", "c"], photo_count: 3 })],
      tombstones: [],
      next_cursor: null,
      server_time: "0",
    };
    applyUserAlbumsPage(t.db, env as never, Date.now());
    const members = t.db.all(sql`SELECT photo_id FROM user_album_photo WHERE album_id = 7`) as {
      photo_id: string;
    }[];
    expect(members.map((m) => m.photo_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("is cancellable via AbortSignal", async () => {
    const store = emptyStore();
    store.photo = photos(10);
    const controller = new AbortController();
    controller.abort();
    await expect(
      pullEntity(t.db, new FakeSource(store), "photo", { signal: controller.signal })
    ).rejects.toBeInstanceOf(SyncAbortedError);
  });
});

describe("pullAll ordering", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("pulls entities in the doc 03 §1 dependency order", async () => {
    const store = emptyStore();
    store.photo = [photoItem("p1")];
    store.person = [personItem(1)];
    store.user_album = [userAlbumItem(1)];
    store.auto_album = [autoAlbumItem(1)];
    const source = new FakeSource(store);

    await pullAll(t.db, source);

    // First appearance of each entity, in order.
    const firstSeen: string[] = [];
    for (const e of source.fetchOrder) if (!firstSeen.includes(e)) firstSeen.push(e);
    expect(firstSeen).toEqual([
      "photo",
      "person",
      "user_album",
      "auto_album",
      "thing_album",
      "place_album",
      "tag_album",
      "sharing",
    ]);
  });
});
