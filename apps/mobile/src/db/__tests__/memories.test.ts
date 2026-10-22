import { createTestDb, type TestDb } from "../test-db";
import { seedRemotePhotos, remotePhoto } from "./fixtures";
import {
  formatTime,
  getMemoriesNotifPrefs,
  memoryDaysAhead,
  memoryYears,
  monthDayOf,
  onThisDay,
  parseTime,
  setMemoriesNotifPrefs,
} from "../queries/memories";
import { defined } from "@/test/defined";

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
    expect(defined(res[0]).year).toBe(2023);
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

/** Local noon of a day, so the bucket day is that day in every time zone. */
function noon(year: number, month: number, day: number): number {
  return new Date(year, month, day, 12).getTime();
}

describe("memoryDaysAhead (#2746)", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("lists 14 days from today at local midnight, empty ones with zero counts", () => {
    const days = memoryDaysAhead(t.db, { today: new Date(2025, 5, 15, 18, 30) });
    expect(days).toHaveLength(14);
    expect(defined(days[0]).day).toEqual(new Date(2025, 5, 15));
    expect(defined(days[13]).day).toEqual(new Date(2025, 5, 28));
    expect(days.every((d) => d.photoCount === 0 && d.yearCount === 0)).toBe(true);
  });

  it("counts the photos and the distinct earlier years of each day", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "a", timestamp: noon(2020, 5, 16) }),
      remotePhoto({ id: "b", imageHash: "b", timestamp: noon(2021, 5, 16) }),
      remotePhoto({ id: "c", imageHash: "c", timestamp: noon(2021, 5, 16) }),
      remotePhoto({ id: "d", imageHash: "d", timestamp: noon(2025, 5, 16) }), // this year
      remotePhoto({ id: "e", imageHash: "e", timestamp: noon(2019, 5, 16), hidden: true }),
      remotePhoto({ id: "f", imageHash: "f", timestamp: noon(2018, 5, 17), inTrashcan: true }),
    ]);
    const days = memoryDaysAhead(t.db, { today: new Date(2025, 5, 15, 8), days: 3 });
    expect(days.map((d) => [d.photoCount, d.yearCount])).toEqual([
      [0, 0],
      [3, 2],
      [0, 0],
    ]);
  });

  it("counts last year's photos on a day in the new year", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "a", timestamp: noon(2025, 0, 1) }),
      remotePhoto({ id: "b", imageHash: "b", timestamp: noon(2025, 11, 31) }), // today, this year
    ]);
    const days = memoryDaysAhead(t.db, { today: new Date(2025, 11, 31, 9), days: 2 });
    expect(days.map((d) => d.day)).toEqual([new Date(2025, 11, 31), new Date(2026, 0, 1)]);
    expect(days.map((d) => d.photoCount)).toEqual([0, 1]);
  });

  it("finds Feb 29 memories only in a leap year", () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "a", imageHash: "a", timestamp: noon(2024, 1, 29) })]);
    const leap = memoryDaysAhead(t.db, { today: new Date(2028, 1, 28), days: 2 });
    expect(leap.map((d) => [d.day.getDate(), d.photoCount])).toEqual([
      [28, 0],
      [29, 1],
    ]);
    const common = memoryDaysAhead(t.db, { today: new Date(2027, 1, 28), days: 2 });
    expect(common.map((d) => [d.day.getMonth(), d.day.getDate(), d.photoCount])).toEqual([
      [1, 28, 0],
      [2, 1, 0],
    ]);
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
