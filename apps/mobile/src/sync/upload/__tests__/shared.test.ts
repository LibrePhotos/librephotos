import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { enqueueSharedUploads, SHARED_UPLOADS_ALBUM_ID } from "../shared";
import { sweepOrphanAssets } from "@/sync/device/media-store";

describe("enqueueSharedUploads", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("creates local_asset + membership + pending queue rows", () => {
    const n = enqueueSharedUploads(t.db, [
      { id: "s1", uri: "content://a", name: "a.jpg" },
      { id: "s2", uri: "content://b", type: "video" },
    ]);
    expect(n).toBe(2);

    const assets = t.db.all(sql`SELECT id, hash FROM local_asset ORDER BY id`) as { id: string; hash: string | null }[];
    expect(assets.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(assets[0]!.hash).toBeNull(); // hashed later by the hash pass

    const queued = t.db.all(sql`SELECT asset_id, state FROM upload_queue ORDER BY asset_id`) as {
      asset_id: string;
      state: string;
    }[];
    expect(queued).toEqual([
      { asset_id: "s1", state: "pending" },
      { asset_id: "s2", state: "pending" },
    ]);
  });

  it("is idempotent per id", () => {
    enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    const n = enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    expect(n).toBe(0);
    const count = t.db.get(sql`SELECT COUNT(*) AS c FROM upload_queue`) as { c: number };
    expect(count.c).toBe(1);
  });

  it("survives the orphan sweep (has synthetic album membership)", () => {
    enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    sweepOrphanAssets(t.db);
    const asset = t.db.get(sql`SELECT id FROM local_asset WHERE id = 's1'`) as { id: string } | undefined;
    expect(asset).toBeTruthy();
    const album = t.db.get(sql`SELECT id FROM local_album WHERE id = ${SHARED_UPLOADS_ALBUM_ID}`) as
      | { id: string }
      | undefined;
    expect(album).toBeTruthy();
  });
});
