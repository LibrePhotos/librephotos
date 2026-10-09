import { describe, expect, it } from "vitest";
import { eventStartDate } from "./eventDate";

describe("eventStartDate", () => {
  // An event whose first photo is at 08:00 on Apr 1 is keyed at 20:01 the evening before
  it("undoes the grouping key's offset when the server sends no start", () => {
    const start = eventStartDate({ timestamp: "2024-03-31T20:01:00Z" });

    expect(start.toISODate()).toBe("2024-04-01");
    expect(start.toFormat("HH:mm")).toBe("08:00");
  });

  it("prefers the first photo's time", () => {
    const start = eventStartDate({ timestamp: "2024-03-31T20:01:00Z", start: "2024-04-01T08:30:00Z" });

    expect(start.toFormat("yyyy-MM-dd HH:mm")).toBe("2024-04-01 08:30");
  });

  it("falls back to the key for a null start", () => {
    expect(eventStartDate({ timestamp: "2024-03-31T20:01:00Z", start: null }).toISODate()).toBe("2024-04-01");
  });

  // exif_timestamp is the wall clock: no browser zone may move it to another day
  it("reads the wall clock as UTC", () => {
    const start = eventStartDate({ timestamp: "2024-03-31T00:00:00Z", start: "2024-04-01T23:30:00" });

    expect(start.zoneName).toBe("UTC");
    expect(start.toISODate()).toBe("2024-04-01");
  });

  it("is invalid, not a wrong date, for an unparseable timestamp", () => {
    expect(eventStartDate({ timestamp: "" }).isValid).toBe(false);
  });
});
