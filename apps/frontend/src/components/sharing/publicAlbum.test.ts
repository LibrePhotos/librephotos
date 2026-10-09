/**
 * A public album whose owner keeps the dates private arrives as one group
 * without a date. Shown as a date view, that read "Without Timestamp" and
 * "1 day" although the photos have dates.
 */
import { describe, expect, it } from "vitest";
import { isUndatedShare } from "./publicAlbum";

describe("isUndatedShare", () => {
  it("is true for the single undated group of a share without timestamps", () => {
    expect(isUndatedShare([{ date: null }])).toBe(true);
    expect(isUndatedShare([{ date: "" }])).toBe(true);
  });

  it("is false for an album that shares its dates", () => {
    expect(isUndatedShare([{ date: "2024-06-01" }])).toBe(false);
    expect(isUndatedShare([{ date: "2024-06-01" }, { date: null }])).toBe(false);
    expect(isUndatedShare([])).toBe(false);
  });
});
