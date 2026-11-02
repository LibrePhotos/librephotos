/**
 * @jest-environment node
 *
 * Archived photos leave the timeline (#545), and the timeline filter narrows it
 * offline the way the web's filter popover does: media, favorites only, hide
 * screenshots, hide documents. Both shapes (remote fast path and the merged
 * camera-roll UNION) and the buckets must agree.
 */
import { createTestDb, type TestDb } from "../test-db";
import {
  NO_TIMELINE_FILTER,
  isTimelineFilterActive,
  timelineBuckets,
  timelineCursorFor,
  timelinePage,
  type TimelineCursor,
  type TimelineFilter,
} from "../queries/timeline";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "./fixtures";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

const filter = (over: Partial<TimelineFilter>): TimelineFilter => ({ ...NO_TIMELINE_FILTER, ...over });

function ids(t: TestDb, f: TimelineFilter = NO_TIMELINE_FILTER): (string | null)[] {
  return timelinePage(t.db, { limit: 100, filter: f }).rows.map((r) => r.remote_id ?? r.local_id);
}

function bucketTotal(t: TestDb, f: TimelineFilter = NO_TIMELINE_FILTER): number {
  return timelineBuckets(t.db, f).reduce((n, b) => n + b.count, 0);
}

describe("isTimelineFilterActive", () => {
  it("is false only for the empty filter", () => {
    expect(isTimelineFilterActive(NO_TIMELINE_FILTER)).toBe(false);
    expect(isTimelineFilterActive(filter({ media: "photos" }))).toBe(true);
    expect(isTimelineFilterActive(filter({ media: "videos" }))).toBe(true);
    expect(isTimelineFilterActive(filter({ favorites: true }))).toBe(true);
    expect(isTimelineFilterActive(filter({ hideScreenshots: true }))).toBe(true);
    expect(isTimelineFilterActive(filter({ hideDocuments: true }))).toBe(true);
  });
});

describe("archived photos and the timeline", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("leaves archived photos out of the page, the buckets and the cursor", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", timestamp: D(2024, 1, 2) }),
      remotePhoto({ id: "arch", imageHash: "harch", timestamp: D(2024, 1, 3), archived: true }),
    ]);
    expect(ids(t)).toEqual(["a"]);
    expect(bucketTotal(t)).toBe(1);
    expect(timelineCursorFor(t.db, "arch")).toBeNull();
    expect(timelineCursorFor(t.db, "harch")).toBeNull();
    expect(timelineCursorFor(t.db, "a")?.sortId).toBe("a");
  });

  describe("an archived photo still in the camera roll", () => {
    beforeEach(() => {
      seedRemotePhotos(t.db, [
        remotePhoto({ id: "keep", imageHash: "hk", timestamp: D(2024, 3, 1) }),
        remotePhoto({ id: "arch", imageHash: "ha", timestamp: D(2024, 3, 2), archived: true }),
      ]);
      insertLocalAsset(t.db, { id: "L-arch", hash: "ha", createdAt: D(2024, 3, 2) });
      insertLocalAsset(t.db, { id: "L-only", hash: "hl", createdAt: D(2024, 3, 3) });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L-arch", "L-only"] });
    });

    it("does not come back as a camera-roll photo", () => {
      expect(ids(t)).toEqual(["L-only", "keep"]);
      expect(bucketTotal(t)).toBe(2);
    });

    it("has no cursor through its camera-roll id either", () => {
      expect(timelineCursorFor(t.db, "L-arch")).toBeNull();
      expect(timelineCursorFor(t.db, "L-only")?.sortId).toBe("L-only");
    });

    it("returns once it is unarchived, as the server row", () => {
      seedRemotePhotos(t.db, [remotePhoto({ id: "arch", imageHash: "ha", timestamp: D(2024, 3, 2) })]);
      const rows = timelinePage(t.db, { limit: 100 }).rows;
      expect(rows.map((r) => [r.remote_id, r.local_id])).toEqual([
        [null, "L-only"],
        ["arch", "L-arch"],
        ["keep", null],
      ]);
    });
  });
});

describe("timeline filter", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "img", timestamp: D(2024, 1, 9) }),
      remotePhoto({ id: "motion", timestamp: D(2024, 1, 8), type: "motion" }),
      remotePhoto({ id: "vid", timestamp: D(2024, 1, 7), type: "video" }),
      remotePhoto({ id: "fav", timestamp: D(2024, 1, 6), isFavorite: true, rating: 5 }),
      remotePhoto({ id: "favvid", timestamp: D(2024, 1, 5), type: "video", isFavorite: true, rating: 5 }),
      remotePhoto({ id: "shot", timestamp: D(2024, 1, 4), isScreenshot: true }),
      remotePhoto({ id: "doc", timestamp: D(2024, 1, 3), isDocument: true }),
      remotePhoto({ id: "favshot", timestamp: D(2024, 1, 2), isScreenshot: true, isFavorite: true, rating: 5 }),
      remotePhoto({ id: "archvid", timestamp: D(2024, 1, 1), type: "video", archived: true }),
    ]);
  });
  afterEach(() => t.close());

  it("without a filter shows every visible, unarchived photo", () => {
    expect(ids(t)).toEqual(["img", "motion", "vid", "fav", "favvid", "shot", "doc", "favshot"]);
  });

  it.each<[string, Partial<TimelineFilter>, string[]]>([
    ["photos: images and motion photos", { media: "photos" }, ["img", "motion", "fav", "shot", "doc", "favshot"]],
    ["videos", { media: "videos" }, ["vid", "favvid"]],
    ["favorites only", { favorites: true }, ["fav", "favvid", "favshot"]],
    ["hide screenshots", { hideScreenshots: true }, ["img", "motion", "vid", "fav", "favvid", "doc"]],
    ["hide documents", { hideDocuments: true }, ["img", "motion", "vid", "fav", "favvid", "shot", "favshot"]],
    ["favorite photos without screenshots", { media: "photos", favorites: true, hideScreenshots: true }, ["fav"]],
    ["everything hidden away", { media: "videos", hideScreenshots: true, hideDocuments: true }, ["vid", "favvid"]],
  ])("%s (page and buckets agree)", (_label, over, expected) => {
    const f = filter(over);
    expect(ids(t, f)).toEqual(expected);
    expect(bucketTotal(t, f)).toBe(expected.length);
  });

  it("pages a filtered timeline with the keyset cursor", () => {
    const f = filter({ media: "photos" });
    const seen: string[] = [];
    let cursor: TimelineCursor | null = null;
    for (let i = 0; i < 10; i++) {
      const p = timelinePage(t.db, { limit: 2, cursor, filter: f });
      for (const r of p.rows) seen.push(r.remote_id ?? "");
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen).toEqual(["img", "motion", "fav", "shot", "doc", "favshot"]);
  });

  describe("with camera-roll-only rows (merged path)", () => {
    beforeEach(() => {
      insertLocalAsset(t.db, { id: "L-img", hash: "lh1", createdAt: D(2024, 2, 2), type: "image" });
      insertLocalAsset(t.db, { id: "L-vid", hash: "lh2", createdAt: D(2024, 2, 1), type: "video" });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L-img", "L-vid"] });
    });

    it.each<[string, Partial<TimelineFilter>, string[]]>([
      ["media photos keeps the camera-roll image", { media: "photos" }, ["L-img"]],
      ["media videos keeps the camera-roll video", { media: "videos" }, ["L-vid"]],
      ["favorites only drops them (not favorites on the server)", { favorites: true }, []],
      ["hide screenshots keeps them (unknown)", { hideScreenshots: true }, ["L-img", "L-vid"]],
      ["hide documents keeps them (unknown)", { hideDocuments: true }, ["L-img", "L-vid"]],
    ])("%s", (_label, over, expectedLocal) => {
      const f = filter(over);
      const rows = timelinePage(t.db, { limit: 100, filter: f }).rows;
      expect(rows.filter((r) => r.remote_id === null).map((r) => r.local_id)).toEqual(expectedLocal);
      expect(bucketTotal(t, f)).toBe(rows.length);
    });

    it("a remote screenshot's camera-roll copy stays hidden with it", () => {
      insertLocalAsset(t.db, { id: "L-shot", hash: "hash-shot", createdAt: D(2024, 1, 4) });
      insertLocalAlbum(t.db, { id: "cam2", backupSelection: 1, assetIds: ["L-shot"] });
      const f = filter({ hideScreenshots: true });
      const keys = ids(t, f);
      expect(keys).not.toContain("shot");
      expect(keys).not.toContain("L-shot");
    });
  });
});
