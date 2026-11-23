import { Settings } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { countQuartiles, dayHeatmap, dayLevel, weeksForWidth } from "./dayHeatmap";

let locale: string;
beforeAll(() => {
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
});
afterAll(() => {
  Settings.defaultLocale = locale;
});

describe("dayHeatmap", () => {
  it("lays days out by week and weekday, weeks starting Sunday", () => {
    const grid = dayHeatmap(
      [
        { day: "2024-03-01", count: 2 },
        { day: "2024-03-06", count: 5 },
      ],
      53,
      0
    );

    const friday = defined(grid.cells.find(cell => cell.day === "2024-03-01"));
    const wednesday = defined(grid.cells.find(cell => cell.day === "2024-03-06"));
    expect(friday).toMatchObject({ row: 5, column: 0, count: 2 });
    expect(wednesday).toMatchObject({ column: 1, row: 3, count: 5 });
    expect(defined(grid.cells.at(-1)).day).toBe("2024-03-06");
  });

  it("ends at the last day with photos and covers at most 53 weeks", () => {
    const counts = [
      { day: "2010-01-04", count: 1 },
      { day: "2024-03-06", count: 1 },
    ];
    const grid = dayHeatmap(counts, 53, 1);

    expect(grid.weeks).toBe(53);
    expect(grid.cells).toHaveLength(52 * 7 + 3);
    expect(defined(grid.cells.at(-1)).day).toBe("2024-03-06");
  });

  it("keeps the whole span when it is shorter than the window", () => {
    const grid = dayHeatmap([{ day: "2024-03-04", count: 1 }], 53, 1);

    expect(grid.weeks).toBe(1);
    expect(grid.cells).toHaveLength(1);
  });

  it("drops days that are no calendar day and empties on none", () => {
    expect(dayHeatmap([{ day: "2024-13-40", count: 3 }]).cells).toHaveLength(0);
    expect(dayHeatmap([]).cells).toHaveLength(0);
  });

  it("names the month over the column that holds its first day", () => {
    const grid = dayHeatmap(
      [
        { day: "2024-02-20", count: 1 },
        { day: "2024-03-06", count: 1 },
      ],
      53,
      1
    );

    const march = defined(grid.monthTicks.find(tick => tick.text === "Mar"));
    const marchFirst = defined(grid.cells.find(cell => cell.day === "2024-03-01"));
    expect(march.column).toBe(marchFirst.column);
  });
});

describe("levels", () => {
  it("splits the nonzero counts at their quartiles", () => {
    const quartiles = countQuartiles([1, 1, 1, 4, 4, 4, 8, 8, 16]);
    expect(quartiles).toEqual([1, 4, 8]);
    expect(dayLevel(0, quartiles)).toBe(0);
    expect(dayLevel(1, quartiles)).toBe(1);
    expect(dayLevel(4, quartiles)).toBe(2);
    expect(dayLevel(8, quartiles)).toBe(3);
    expect(dayLevel(16, quartiles)).toBe(4);
  });

  it("levels every day alike when the counts are alike", () => {
    expect(dayLevel(5, countQuartiles([5, 5, 5]))).toBe(1);
  });
});

describe("weeksForWidth", () => {
  it("shows the full window on a wide card and fewer weeks on a narrow one", () => {
    expect(weeksForWidth(900)).toBe(53);
    expect(weeksForWidth(320)).toBeLessThan(53);
    expect(weeksForWidth(0)).toBe(0);
  });
});
