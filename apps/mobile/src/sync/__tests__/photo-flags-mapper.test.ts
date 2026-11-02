/**
 * @jest-environment node
 *
 * The delta feed's archive and media-category flags land in the mirror, and an
 * older server that sends none of them leaves them off.
 */
import { sql } from "drizzle-orm";
import type { SyncPhotoItem, SyncPhotosResponse } from "@librephotos/api-client";
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncPhotoToRow } from "../remote/mappers";
import { applyPhotosPage } from "../remote/applier";
import { photoItem } from "./fake-source";

type FlagRow = { id: string; archived: number; is_screenshot: number; is_document: number };

function flags(t: TestDb): FlagRow[] {
  return t.db.all(
    sql`SELECT id, archived, is_screenshot, is_document FROM remote_photo ORDER BY id`
  ) as FlagRow[];
}

describe("syncPhotoToRow: archive and category flags", () => {
  it("copies the three flags", () => {
    const row = syncPhotoToRow(photoItem("p1", { archived: true, is_screenshot: true, is_document: false }), 0);
    expect([row.archived, row.isScreenshot, row.isDocument]).toEqual([true, true, false]);
    const doc = syncPhotoToRow(photoItem("p2", { archived: false, is_screenshot: false, is_document: true }), 0);
    expect([doc.archived, doc.isScreenshot, doc.isDocument]).toEqual([false, false, true]);
  });

  it("defaults them to false for a server that does not send them", () => {
    const row = syncPhotoToRow(photoItem("p1"), 0);
    expect([row.archived, row.isScreenshot, row.isDocument]).toEqual([false, false, false]);
  });
});

describe("applyPhotosPage: archive and category flags", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  const page = (items: SyncPhotoItem[]): SyncPhotosResponse => ({
    v: 1,
    items,
    tombstones: [],
    next_cursor: null,
    server_time: "0",
  });

  it("writes the flags and a later page flips them back", () => {
    applyPhotosPage(
      t.db,
      page([
        photoItem("a", { archived: true }),
        photoItem("b", { is_screenshot: true }),
        photoItem("c", { is_document: true }),
      ]),
      0
    );
    expect(flags(t)).toEqual([
      { id: "a", archived: 1, is_screenshot: 0, is_document: 0 },
      { id: "b", archived: 0, is_screenshot: 1, is_document: 0 },
      { id: "c", archived: 0, is_screenshot: 0, is_document: 1 },
    ]);

    applyPhotosPage(
      t.db,
      page([
        photoItem("a", { archived: false, last_modified: 2000 }),
        photoItem("b", { is_screenshot: false, last_modified: 2000 }),
        photoItem("c", { is_document: false, last_modified: 2000 }),
      ]),
      0
    );
    expect(flags(t).every((r) => r.archived + r.is_screenshot + r.is_document === 0)).toBe(true);
  });
});
