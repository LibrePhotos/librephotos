/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { ApiError } from "@librephotos/api-client";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { setMetaNumber, META_FAVORITE_MIN_RATING } from "@/db/queries/app-meta";
import { favoritePhotos, createAlbum, addPhotosToAlbum } from "@/mutations/actions";
import { enqueueOutbox, pendingOutboxCount, MAX_ATTEMPTS, INFLIGHT_STALE_MS } from "@/mutations/outbox";
import { drainOutbox, reconcileTempAlbum, type OutboxExecutor } from "../outbox/replay";
import { syncAll } from "../orchestrator";
import { FakeSource, emptyStore, photoItem } from "./fake-source";

/** Executor that records calls and can be told to fail specific kinds. */
function makeExecutor(over: Partial<OutboxExecutor> = {}): OutboxExecutor & { calls: string[] } {
  const calls: string[] = [];
  const rec =
    <T>(name: string, ret?: T) =>
    async (): Promise<T> => {
      calls.push(name);
      return ret as T;
    };
  return {
    calls,
    favorite: rec("favorite"),
    hide: rec("hide"),
    trash: rec("trash"),
    rating: rec("rating"),
    caption: rec("caption"),
    albumAdd: rec("albumAdd"),
    albumRemove: rec("albumRemove"),
    albumCreate: rec("albumCreate", { id: 999 }),
    albumRename: rec("albumRename"),
    personRename: rec("personRename"),
    ...over,
  };
}

describe("drainOutbox", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setMetaNumber(t.db, META_FAVORITE_MIN_RATING, 4);
    seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "hA" })]);
  });
  afterEach(() => t.close());

  it("success deletes the row and reports replayed", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    const exec = makeExecutor();
    const res = await drainOutbox(t.db, exec, { now: () => 1000 });
    expect(res).toMatchObject({ replayed: 1, dropped: 0, remaining: 0 });
    expect(exec.calls).toEqual(["favorite"]);
    expect(pendingOutboxCount(t.db)).toBe(0);
  });

  it("drains in FIFO order", async () => {
    enqueueOutbox(t.db, "hide", { imageHashes: ["hA"], hidden: true });
    enqueueOutbox(t.db, "trash", { imageHashes: ["hA"], deleted: true });
    const exec = makeExecutor();
    await drainOutbox(t.db, exec);
    expect(exec.calls).toEqual(["hide", "trash"]);
  });

  it("4xx drops the row, logs, and pushes a toast", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    const toasts: unknown[] = [];
    const logs: unknown[] = [];
    const exec = makeExecutor({
      favorite: async () => {
        throw new ApiError(400, "/photosedit/favorite/", "bad request");
      },
    });
    const res = await drainOutbox(t.db, exec, {
      now: () => 1000,
      onToast: (x) => toasts.push(x),
      log: (x) => logs.push(x),
    });
    expect(res).toMatchObject({ replayed: 0, dropped: 1, remaining: 0 });
    expect(pendingOutboxCount(t.db)).toBe(0);
    expect(toasts).toHaveLength(1);
  });

  it("network error keeps the row, backs off, and stops the pass", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    enqueueOutbox(t.db, "hide", { imageHashes: ["hA"], hidden: true });
    const exec = makeExecutor({
      favorite: async () => {
        throw new TypeError("Network request failed");
      },
    });
    const res = await drainOutbox(t.db, exec, { now: () => 1000 });
    expect(res.replayed).toBe(0);
    // The failed favorite is kept as `failed`; the second row never ran (stop).
    expect(exec.calls).toEqual([]);
    const row = t.db.get(sql`SELECT state, attempts, next_attempt_at FROM outbox ORDER BY id LIMIT 1`) as {
      state: string;
      attempts: number;
      next_attempt_at: number;
    };
    expect(row.state).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBeGreaterThan(1000);
  });

  it("5xx is treated as transient (kept, not dropped)", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    const exec = makeExecutor({
      favorite: async () => {
        throw new ApiError(503, "/x", "unavailable");
      },
    });
    const res = await drainOutbox(t.db, exec, { now: () => 1000 });
    expect(res).toMatchObject({ replayed: 0, dropped: 0 });
    expect(pendingOutboxCount(t.db)).toBe(1);
  });

  it("a failed row is not retried until its backoff window passes", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    let fail = true;
    const exec = makeExecutor({
      favorite: async () => {
        if (fail) throw new TypeError("down");
      },
    });
    await drainOutbox(t.db, exec, { now: () => 1000 }); // fails, backoff window set
    fail = false;
    // Still inside the backoff window → nothing eligible.
    const early = await drainOutbox(t.db, exec, { now: () => 1001 });
    expect(early.replayed).toBe(0);
    // After the window → retried and succeeds.
    const late = await drainOutbox(t.db, exec, { now: () => 10_000_000 });
    expect(late.replayed).toBe(1);
  });

  it("reclaims a crashed inflight row and replays it", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    // Simulate a crash mid-flight: row stuck 'inflight' with an old timestamp.
    t.db.run(sql`UPDATE outbox SET state = 'inflight', inflight_at = ${1000}`);
    const exec = makeExecutor();
    const res = await drainOutbox(t.db, exec, { now: () => 1000 + INFLIGHT_STALE_MS + 1 });
    expect(res.replayed).toBe(1);
    expect(pendingOutboxCount(t.db)).toBe(0);
  });

  it("caps retries so a persistently-failing row eventually parks", async () => {
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });
    const exec = makeExecutor({
      favorite: async () => {
        throw new TypeError("down");
      },
    });
    let now = 1000;
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await drainOutbox(t.db, exec, { now: () => now });
      now += 10 ** 12; // jump well past any backoff window
    }
    const row = t.db.get(sql`SELECT attempts FROM outbox LIMIT 1`) as { attempts: number } | undefined;
    // Row stays (parked) but attempts is capped at MAX_ATTEMPTS.
    expect(row?.attempts).toBe(MAX_ATTEMPTS);
  });
});

describe("temp-id reconciliation", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [remotePhoto({ id: "pa", imageHash: "hA" })]);
  });
  afterEach(() => t.close());

  it("swaps the temp album id for the server id on album_create replay", async () => {
    const { tempId } = createAlbum(t.db, { title: "New", photoIds: ["pa"], ownerId: 1 });
    // A chained add against the same temp album (still pending).
    addPhotosToAlbum(t.db, { albumId: tempId, title: "New", photoIds: ["pa"], imageHashes: ["hA"] });

    const exec = makeExecutor({ albumCreate: async () => ({ id: 42 }) });
    await drainOutbox(t.db, exec);

    // Mirror row remapped to the server id.
    expect(t.db.get(sql`SELECT id FROM user_album WHERE id = ${tempId}`)).toBeUndefined();
    expect(t.db.get(sql`SELECT title FROM user_album WHERE id = 42`)).toMatchObject({ title: "New" });
    expect(t.db.all(sql`SELECT album_id FROM user_album_photo WHERE album_id = 42`)).toHaveLength(1);
    // The chained add succeeded too (both rows drained).
    expect(pendingOutboxCount(t.db)).toBe(0);
  });

  it("reconcileTempAlbum rewrites pending outbox payloads referencing the temp id", () => {
    const { tempId } = createAlbum(t.db, { title: "X", photoIds: [] });
    addPhotosToAlbum(t.db, { albumId: tempId, title: "X", photoIds: ["pa"], imageHashes: ["hA"] });
    reconcileTempAlbum(t.db, tempId, 77);
    const add = t.db.get(sql`SELECT payload FROM outbox WHERE kind = 'album_add'`) as { payload: string };
    expect(JSON.parse(add.payload).albumId).toBe(77);
  });
});

describe("replay-first ordering (integration)", () => {
  it("replay pushes the local change before the pull, so the pull confirms it", async () => {
    const t = createTestDb();
    setMetaNumber(t.db, META_FAVORITE_MIN_RATING, 4);

    // Seed a photo, unfavorited on the server.
    const store = emptyStore();
    store.photo = [photoItem("p1", { image_hash: "hA", is_favorite: false, rating: 0, last_modified: 1000 })];
    const source = new FakeSource(store);
    await syncAll(t.db, source);
    expect((t.db.get(sql`SELECT is_favorite FROM remote_photo WHERE id = 'p1'`) as { is_favorite: number }).is_favorite).toBe(0);

    // Offline: favorite it (optimistic mirror flip + outbox row).
    favoritePhotos(t.db, { imageHashes: ["hA"], favorite: true });

    // Executor = "the server applies it": mutate the fake store so the ensuing
    // delta returns the favorited row (newer last_modified).
    const exec: OutboxExecutor = {
      ...makeExecutor(),
      favorite: async () => {
        store.photo = [photoItem("p1", { image_hash: "hA", is_favorite: true, rating: 4, last_modified: 5000 })];
      },
    };

    // Next sync: replay-first drains the outbox (server now favorited), THEN the
    // delta pull confirms — the optimistic flip is never clobbered.
    const res = await syncAll(t.db, source, {
      replayOutbox: (ctx) => drainOutbox(ctx.db, exec, { now: () => ctx.now }),
    });
    expect(res.outbox).toMatchObject({ replayed: 1, remaining: 0 });
    expect((t.db.get(sql`SELECT is_favorite FROM remote_photo WHERE id = 'p1'`) as { is_favorite: number }).is_favorite).toBe(1);
    expect(pendingOutboxCount(t.db)).toBe(0);
    t.close();
  });
});
