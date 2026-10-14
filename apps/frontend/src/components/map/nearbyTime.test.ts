import { Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatAmount, nearbyWindow, offsetFromSpan } from "./nearbyTime";

const SPAN = { first: "2026-10-11T09:00:00Z", last: "2026-10-11T18:00:00Z" };

describe("nearbyWindow", () => {
  it("adds a day either side, in UTC like the timestamps", () => {
    expect(nearbyWindow(SPAN)).toEqual({ from: "2026-10-10T09:00:00.000Z", to: "2026-10-12T18:00:00.000Z" });
  });

  it("has no window without dates", () => {
    expect(nearbyWindow(null)).toBeNull();
    expect(nearbyWindow({ first: "nope", last: SPAN.last })).toBeNull();
  });
});

describe("offsetFromSpan", () => {
  it.each([
    ["2026-10-11T12:00:00Z", { side: "during", amount: 0, unit: "minutes" }],
    ["2026-10-11T08:25:00Z", { side: "before", amount: 35, unit: "minutes" }],
    ["2026-10-11T06:50:00Z", { side: "before", amount: 2, unit: "hours" }],
    ["2026-10-12T20:00:00Z", { side: "after", amount: 26, unit: "hours" }],
    ["2026-10-08T09:00:00Z", { side: "before", amount: 3, unit: "days" }],
  ])("%s", (taken, offset) => {
    expect(offsetFromSpan(taken, SPAN)).toEqual(offset);
  });
});

describe("formatAmount", () => {
  let locale: string;
  beforeEach(() => {
    locale = Settings.defaultLocale;
    Settings.defaultLocale = "en";
  });
  afterEach(() => {
    Settings.defaultLocale = locale;
  });

  it("writes the amount short, in the UI language", () => {
    expect(formatAmount({ side: "before", amount: 2, unit: "hours" })).toBe("2 hr");
  });
});
