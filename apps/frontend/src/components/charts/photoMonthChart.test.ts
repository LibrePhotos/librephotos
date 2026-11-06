import { describe, expect, it } from "vitest";
import { photoMonthChart } from "./photoMonthChart";

const months = (from: number, to: number) =>
  Array.from({ length: (to - from + 1) * 12 }, (_unused, i) => ({
    month: `${from + Math.floor(i / 12)}-${(i % 12) + 1}`,
    count: i,
  }));

describe("photoMonthChart", () => {
  it("ticks the axis once per year, labelled with the year", () => {
    const { bars, ticks, yearOf } = photoMonthChart([{ month: "2009-6", count: 3 }, ...months(2010, 2011)]);

    expect(bars).toHaveLength(25);
    expect(ticks).toEqual(["2009-6", "2010-1", "2011-1"]);
    expect(ticks.map(tick => yearOf.get(tick))).toEqual(["2009", "2010", "2011"]);
  });

  it("labels every second year when there are many", () => {
    const { ticks } = photoMonthChart(months(2000, 2019));

    expect(ticks).toHaveLength(10);
    expect(ticks[1]).toBe("2002-1");
  });
});
