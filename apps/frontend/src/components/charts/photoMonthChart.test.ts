import { Settings } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chartBucket, photoMonthChart } from "./photoMonthChart";

const months = (from: number, to: number) =>
  Array.from({ length: (to - from + 1) * 12 }, (_unused, i) => ({
    month: `${from + Math.floor(i / 12)}-${(i % 12) + 1}`,
    count: i,
  }));

const WIDE = 2000;

let locale: string;
beforeAll(() => {
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
});
afterAll(() => {
  Settings.defaultLocale = locale;
});

describe("photoMonthChart", () => {
  it("ticks the axis once per year, labelled with the year", () => {
    const { bars, ticks, yearOf } = photoMonthChart([{ month: "2009-6", count: 3 }, ...months(2010, 2011)], WIDE);

    expect(bars).toHaveLength(25);
    expect(ticks).toEqual(["2009-6", "2010-1", "2011-1"]);
    expect(ticks.map(tick => yearOf.get(tick))).toEqual(["2009", "2010", "2011"]);
  });

  it("labels every second year when the axis has room for half of them", () => {
    // 20 years of quarters on 700px: room for 11 year labels
    const { ticks } = photoMonthChart(months(2000, 2019), 700);

    expect(ticks).toHaveLength(10);
    expect(ticks[1]).toBe("2002-1");
  });
});

describe("the timeline's bar size", () => {
  it("keeps months while each bar gets at least 6px", () => {
    expect(chartBucket(24, 600)).toBe(1);
  });

  it("adds months up by quarter, then by year, as the span grows past the width", () => {
    // 17 years on a laptop: 205 months would be 5px slots
    expect(chartBucket(205, 1200)).toBe(3);
    // the same span on a phone
    expect(chartBucket(205, 360)).toBe(12);
  });

  it("sums a quarter's months into one bar named by its months", () => {
    const { bars } = photoMonthChart(
      [
        { month: "2009-2", count: 1 },
        { month: "2009-3", count: 2 },
        { month: "2009-4", count: 4 },
        ...months(2010, 2025),
      ],
      1000
    );

    expect(bars[0]).toMatchObject({ key: "2009-1", Photos: 3, year: 2009 });
    expect(bars[1]).toMatchObject({ key: "2009-4", Photos: 4 });
    // Intl puts thin spaces around the dash
    expect(bars[1]?.month).toMatch(/^Apr\s–\sJun 2009$/u);
  });

  it("sums a year's months into one bar named by the year", () => {
    const { bars } = photoMonthChart(months(2000, 2019), 300);

    expect(bars).toHaveLength(20);
    expect(bars[0]).toMatchObject({ key: "2000-1", month: "2000", Photos: 66 });
  });
});
