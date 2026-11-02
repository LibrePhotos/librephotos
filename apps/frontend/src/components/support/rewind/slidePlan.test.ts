import { describe, expect, it } from "vitest";
import { testRewind } from "./rewindFixture.test-utils";
import { busiestMonth, pace, quietestMonth, rewindSlides } from "./slidePlan";

describe("rewindSlides", () => {
  it("has every slide for a full year", () => {
    expect(rewindSlides(testRewind())).toEqual(["intro", "count", "people", "places", "months", "end"]);
  });

  it("leaves out people and places it has nothing to say about", () => {
    expect(rewindSlides(testRewind({ people: [], place_count: 0 }))).toEqual(["intro", "count", "months", "end"]);
  });

  it("is only the start and the end for an empty year", () => {
    expect(rewindSlides(testRewind({ photo_count: 0, video_count: 0 }))).toEqual(["intro", "end"]);
  });
});

describe("months and days", () => {
  it("finds the busiest and the quietest month, the first on a tie", () => {
    const months = testRewind().months;
    expect(busiestMonth(months)).toBe(7);
    expect(quietestMonth(months)).toBe(1);
    expect(busiestMonth([0, 5, 5])).toBe(1);
  });

  it("says how often photos were taken, in the largest unit that gives one or more", () => {
    expect(pace(4118, 2026)).toEqual({ count: 11, per: "day" });
    expect(pace(57, 2026)).toEqual({ count: 1, per: "week" });
    expect(pace(30, 2026)).toEqual({ count: 3, per: "month" });
    expect(pace(5, 2026)).toBeNull();
  });
});
