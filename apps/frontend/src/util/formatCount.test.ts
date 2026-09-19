import { describe, expect, it } from "vitest";
import { formatCompactCount } from "./formatCount";

describe("formatCompactCount", () => {
  it("leaves small numbers untouched", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatCompactCount(25123)).toBe("25.1K");
    expect(formatCompactCount(1500000)).toBe("1.5M");
  });
});
