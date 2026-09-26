import { createTestDb, type TestDb } from "../test-db";
import { seedRemotePhotos, remotePhoto } from "./fixtures";
import {
  formatTime,
  getMemoriesNotifPrefs,
  memoryYears,
  monthDayOf,
  onThisDay,
  parseTime,
  setMemoriesNotifPrefs,
} from "../queries/memories";

/** June 15th of the given year, at noon UTC. */
function jun15(year: number): number {
  return Date.UTC(year, 5, 15, 12);
}

describe("memories (on this day)", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("monthDayOf formats MM-DD", () => {
    expect(monthDayOf(new Date(2024, 0, 5))).toBe("01-05");
    expect(monthDayOf(new Date(2024, 11, 31))).toBe("12-31");
  });

  it("returns prior-year photos on the same month-day, favorites first", () => {
    const today = new Date(2025, 5, 15, 12); // Jun 15 2025 (local)
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "h2022", timestamp: jun15(2022) }),
      remotePhoto({ id: "p2", imageHash: "h2023fav", timestamp: jun15(2023), isFavorite: true }),
      remotePhoto({ id: "p3", imageHash: "hOther", timestamp: Date.UTC(2023, 6, 1, 12) }), // Jul 1 — excluded
      remotePhoto({ id: "p4", imageHash: "hThisYear", timestamp: jun15(2025) }), // current year — excluded
    ]);
    const res = onThisDay(t.db, { today });
    expect(res.map((m) => m.image_hash)).toEqual(["h2023fav", "h2022"]);
    expect(res[0]!.year).toBe(2023);
  });

  it("excludes hidden and trashed photos", () => {
    const today = new Date(2025, 5, 15, 12);
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "hHidden", timestamp: jun15(2020), hidden: true }),
      remotePhoto({ id: "p2", imageHash: "hTrash", timestamp: jun15(2020), inTrashcan: true }),
      remotePhoto({ id: "p3", imageHash: "hOk", timestamp: jun15(2020) }),
    ]);
    expect(onThisDay(t.db, { today }).map((m) => m.image_hash)).toEqual(["hOk"]);
  });

  it("lists distinct memory years newest-first", () => {
    const today = new Date(2025, 5, 15, 12);
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "p1", imageHash: "a", timestamp: jun15(2021) }),
      remotePhoto({ id: "p2", imageHash: "b", timestamp: jun15(2023) }),
      remotePhoto({ id: "p3", imageHash: "c", timestamp: jun15(2021) }),
    ]);
    expect(memoryYears(t.db, { today })).toEqual([2023, 2021]);
  });
});

describe("memories notification prefs", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("parses and formats HH:MM with defaults + clamping", () => {
    expect(parseTime(null)).toEqual({ hour: 9, minute: 0 });
    expect(parseTime("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseTime("99:99")).toEqual({ hour: 23, minute: 59 });
    expect(parseTime("garbage")).toEqual({ hour: 9, minute: 0 });
    expect(formatTime(7, 5)).toBe("07:05");
  });

  it("defaults to disabled at 09:00 and round-trips prefs", () => {
    expect(getMemoriesNotifPrefs(t.db)).toEqual({ enabled: false, hour: 9, minute: 0 });
    setMemoriesNotifPrefs(t.db, { enabled: true, hour: 20, minute: 15 });
    expect(getMemoriesNotifPrefs(t.db)).toEqual({ enabled: true, hour: 20, minute: 15 });
    setMemoriesNotifPrefs(t.db, { minute: 45 });
    expect(getMemoriesNotifPrefs(t.db)).toEqual({ enabled: true, hour: 20, minute: 45 });
  });
});
