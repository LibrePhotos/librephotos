import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@librephotos/local-db/testing";
import { enqueueSharedUploads, SHARED_UPLOADS_ALBUM_ID } from "../shared";
import { sweepOrphanAssets } from "@/sync/device/media-store";
import { defined } from "@/test/defined";

describe("enqueueSharedUploads", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("creates local_asset + membership + pending queue rows", async () => {
    const n = await enqueueSharedUploads(t.db, [
      { id: "s1", uri: "content://a", name: "a.jpg" },
      { id: "s2", uri: "content://b", type: "video" },
    ]);
    expect(n).toBe(2);

    const assets = await t.db.all<{ id: string; hash: string | null }>(sql`SELECT id, hash FROM local_asset ORDER BY id`);
    expect(assets.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(defined(assets[0]).hash).toBeNull(); // hashed later by the hash pass

    const queued = await t.db.all<{ asset_id: string; state: string; }>(sql`SELECT asset_id, state FROM upload_queue ORDER BY asset_id`);
    expect(queued).toEqual([
      { asset_id: "s1", state: "pending" },
      { asset_id: "s2", state: "pending" },
    ]);
  });

  it("is idempotent per id", async () => {
    await enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    const n = await enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    expect(n).toBe(0);
    const count = await t.db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM upload_queue`);
    expect(count.c).toBe(1);
  });

  it("survives the orphan sweep (has synthetic album membership)", async () => {
    await enqueueSharedUploads(t.db, [{ id: "s1", uri: "content://a" }]);
    await sweepOrphanAssets(t.db);
    const asset = await t.db.get<{ id: string } | undefined>(sql`SELECT id FROM local_asset WHERE id = 's1'`);
    expect(asset).toBeTruthy();
    const album = await t.db.get<{ id: string } | undefined>(sql`SELECT id FROM local_album WHERE id = ${SHARED_UPLOADS_ALBUM_ID}`);
    expect(album).toBeTruthy();
  });
});
