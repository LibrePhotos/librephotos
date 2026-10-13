import { describe, expect, it } from "vitest";
import { pickActiveSection } from "./sectionNavigation";

const TOPS = [
  { id: "a", top: -500 },
  { id: "b", top: 50 },
  { id: "c", top: 700 },
];

describe("pickActiveSection", () => {
  it("picks the last section whose top has passed the offset", () => {
    expect(pickActiveSection(TOPS, 100, false)).toBe("b");
    expect(pickActiveSection(TOPS, 0, false)).toBe("a");
  });

  it("picks the first section before any has reached the offset", () => {
    expect(
      pickActiveSection(
        [
          { id: "a", top: 300 },
          { id: "b", top: 900 },
        ],
        100,
        false
      )
    ).toBe("a");
  });

  it("picks the last section at the bottom of the page", () => {
    expect(pickActiveSection(TOPS, 100, true)).toBe("c");
  });

  it("has nothing to pick on a page without sections", () => {
    expect(pickActiveSection([], 100, false)).toBeUndefined();
    expect(pickActiveSection([], 100, true)).toBeUndefined();
  });
});
