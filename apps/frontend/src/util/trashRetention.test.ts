import { describe, expect, it } from "vitest";
import { parseInstant } from "./dateUtils";
import { trashExpiry } from "./trashRetention";

const NOW = parseInstant("2026-10-13T12:00:00Z");

describe("trashExpiry (#2203)", () => {
  it("has nothing to say without a trashed-on date", () => {
    expect(trashExpiry(null, 30, NOW)).toBeNull();
    expect(trashExpiry(undefined, 30, NOW)).toBeNull();
    expect(trashExpiry("not a date", 30, NOW)).toBeNull();
  });

  it("gives only the trashed-on date while the retention is off or unknown", () => {
    for (const days of [0, undefined]) {
      const expiry = trashExpiry("2026-10-02T08:00:00Z", days, NOW);
      expect(expiry?.trashedOn.toISODate()).toBe("2026-10-02");
      expect(expiry?.deletedOn).toBeNull();
      expect(expiry?.daysLeft).toBeNull();
    }
  });

  it("counts the whole days left until the photo is deleted, rounded up", () => {
    const expiry = trashExpiry("2026-10-02T08:00:00Z", 30, NOW);
    expect(expiry?.deletedOn?.toISODate()).toBe("2026-11-01");
    expect(expiry?.daysLeft).toBe(19);
  });

  it("is due at the next cleanup once the date has passed", () => {
    expect(trashExpiry("2026-08-01T08:00:00Z", 30, NOW)?.daysLeft).toBe(0);
  });
});
