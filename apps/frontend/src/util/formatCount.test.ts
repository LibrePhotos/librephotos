import { describe, expect, it } from "vitest";
import { formatCompactCount, formatCount } from "./formatCount";

describe("formatCompactCount", () => {
  it("leaves small numbers untouched", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatCompactCount(25123)).toBe("25.1K");
    expect(formatCompactCount(1500000)).toBe("1.5M");
  });

  it("handles the thousand boundary", () => {
    expect(formatCompactCount(1000)).toBe("1K");
    expect(formatCompactCount(1049)).toBe("1K");
  });

  it("rolls over to the next unit once rounding reaches it", () => {
    expect(formatCompactCount(999_499)).toBe("999.5K");
    expect(formatCompactCount(999_950)).toBe("1M");
  });

  it("follows the requested locale", () => {
    // German only abbreviates from a million and uses its own separators.
    expect(formatCompactCount(25123, "de")).toBe("25.123");
    expect(formatCompactCount(1500000, "de")).toBe("1,5 Mio.");
    expect(formatCompactCount(25123, "fr")).toBe("25,1 k");
  });
});

describe("formatCount", () => {
  it("groups digits for the requested locale", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(25123)).toBe("25,123");
    expect(formatCount(25123, "de")).toBe("25.123");
  });
});
