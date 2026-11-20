/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../testing";

describe("schema creation", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("creates every mirror / local / app-state table", async () => {
    const rows = await t.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    for (const expected of [
      "remote_photo",
      "remote_photo_detail",
      "person",
      "user_album",
      "user_album_photo",
      "auto_album",
      "auto_album_photo",
      "thing_album",
      "place_album",
      "tag_album",
      "shared_from_me",
      "shared_user",
      "local_asset",
      "local_album",
      "local_album_asset",
      "sync_state",
      "outbox",
      "upload_queue",
      "thumb_cache",
      "sync_log",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("creates the remote_photo partial + covering indexes", async () => {
    const idx = await t.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'remote_photo'`
    );
    const names = idx.map((r) => r.name);
    expect(names).toContain("idx_remote_photo_favorite");
    expect(names).toContain("idx_remote_photo_visible");
    expect(names).toContain("idx_remote_photo_bucket_day");
  });
});
