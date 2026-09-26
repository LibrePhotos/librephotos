import { formatBytes, formatDayHeading, formatFullDate, formatMonthHeading } from "./format";

describe("formatBytes", () => {
  it("formats byte sizes with sensible units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });
});

/**
 * Timeline headers used to render the raw `bucket_day` column ("2026-07-24").
 * These pin the shape users actually see, including the non-English case — the
 * app ships 33 locales, so anything hardcoded to English is a bug.
 */
describe("formatDayHeading", () => {
  const now = new Date(2026, 6, 24); // Fri 24 July 2026, local
  const labels = { today: "Today", yesterday: "Yesterday" };

  it("names today and yesterday", () => {
    expect(formatDayHeading("2026-07-24", { now, labels, locale: "en-US" })).toBe("Today");
    expect(formatDayHeading("2026-07-23", { now, labels, locale: "en-US" })).toBe("Yesterday");
  });

  it("uses weekday + day + month inside the current year", () => {
    expect(formatDayHeading("2026-03-05", { now, labels, locale: "en-US" })).toBe("Thursday, March 5");
  });

  it("adds the year for earlier years", () => {
    expect(formatDayHeading("2019-12-31", { now, labels, locale: "en-US" })).toBe(
      "Tuesday, December 31, 2019"
    );
  });

  it("respects the active locale", () => {
    expect(formatDayHeading("2026-03-05", { now, labels, locale: "de-DE" })).toBe(
      "Donnerstag, 5. März"
    );
    expect(formatDayHeading("2019-12-31", { now, labels, locale: "fr-FR" })).toBe(
      "mardi 31 décembre 2019"
    );
  });

  it("parses the day key as a local date, not UTC", () => {
    // A UTC parse would shift this to the 4th in any western timezone.
    expect(formatDayHeading("2026-03-05", { now, locale: "en-US" })).toContain("March 5");
  });

  it("falls back to the raw key rather than rendering 'Invalid Date'", () => {
    expect(formatDayHeading("not-a-day", { now, labels })).toBe("not-a-day");
  });

  it("shows the absolute date when no Today/Yesterday words are supplied", () => {
    expect(formatDayHeading("2026-07-24", { now, locale: "en-US" })).toBe("Friday, July 24");
  });
});

describe("formatMonthHeading", () => {
  it("formats a month bucket as month + year", () => {
    expect(formatMonthHeading("2026-07", { locale: "en-US" })).toBe("July 2026");
    expect(formatMonthHeading("2026-07-24", { locale: "en-US" })).toBe("July 2026");
    expect(formatMonthHeading("2026-07", { locale: "de-DE" })).toBe("Juli 2026");
  });

  it("returns the input unchanged when it is not a month key", () => {
    expect(formatMonthHeading("nope")).toBe("nope");
  });
});

describe("formatFullDate", () => {
  it("formats an ISO timestamp with date and time", () => {
    const out = formatFullDate("2024-01-03T10:05:00", { locale: "en-US" });
    expect(out).toContain("January 3, 2024");
    expect(out).toMatch(/10:05/);
  });

  it("formats an ms epoch and a day key", () => {
    expect(formatFullDate(new Date(2024, 0, 3, 10, 5).getTime(), { locale: "en-US" })).toContain(
      "January 3, 2024"
    );
    expect(formatFullDate("2024-01-03", { locale: "en-US", withTime: false })).toBe("January 3, 2024");
  });

  it("returns an empty string for missing or unparseable values", () => {
    expect(formatFullDate(null)).toBe("");
    expect(formatFullDate(undefined)).toBe("");
    expect(formatFullDate("")).toBe("");
    expect(formatFullDate("garbage")).toBe("");
  });
});
