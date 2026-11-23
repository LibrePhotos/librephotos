import { DateTime, Settings } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import {
  countQuartiles,
  DAY_CELL_PX,
  dayCellPx,
  dayGridWidth,
  dayHeatmap,
  dayLevel,
  photoYears,
} from "./dayHeatmapGrid";

let locale: string;
beforeAll(() => {
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
});
afterAll(() => {
  Settings.defaultLocale = locale;
});

const TODAY = DateTime.local(2026, 11, 23);

describe("dayHeatmap", () => {
  it("lays days out by week and weekday, weeks starting Sunday", () => {
    const grid = dayHeatmap(
      [
        { day: "2024-03-01", count: 2 },
        { day: "2024-03-06", count: 5 },
      ],
      2024,
      0,
      TODAY
    );

    const newYear = defined(grid.cells[0]);
    const friday = defined(grid.cells.find(cell => cell.day === "2024-03-01"));
    const wednesday = defined(grid.cells.find(cell => cell.day === "2024-03-06"));
    expect(newYear).toMatchObject({ day: "2024-01-01", row: 1, column: 0 });
    expect(friday).toMatchObject({ row: 5, column: 8, count: 2 });
    expect(wednesday).toMatchObject({ row: 3, column: 9, count: 5 });
  });

  it("draws the whole calendar year of a past year", () => {
    const grid = dayHeatmap([{ day: "2023-06-01", count: 1 }], 2023, 1, TODAY);

    expect(grid.cells).toHaveLength(365);
    expect(defined(grid.cells[0]).day).toBe("2023-01-01");
    expect(defined(grid.cells.at(-1)).day).toBe("2023-12-31");
    expect(grid.weeks).toBe(53);
  });

  it("draws this year up to today, or to a later photo", () => {
    expect(defined(dayHeatmap([{ day: "2026-02-01", count: 1 }], 2026, 1, TODAY).cells.at(-1)).day).toBe("2026-11-23");
    expect(defined(dayHeatmap([{ day: "2026-12-05", count: 1 }], 2026, 1, TODAY).cells.at(-1)).day).toBe("2026-12-05");
  });

  it("keeps the rest of this year as empty days, so every year is as wide", () => {
    const thisYear = dayHeatmap([{ day: "2026-02-01", count: 1 }], 2026, 1, TODAY);
    const pastYear = dayHeatmap([{ day: "2025-02-01", count: 1 }], 2025, 1, TODAY);

    expect(defined(thisYear.rest[0]).day).toBe("2026-11-24");
    expect(defined(thisYear.rest.at(-1))).toMatchObject({ day: "2026-12-31", row: 3 });
    expect(thisYear.cells.length + thisYear.rest.length).toBe(365);
    expect(thisYear.weeks).toBe(53);
    expect(pastYear.rest).toHaveLength(0);
    expect(defined(thisYear.monthTicks.at(-1)).text).toBe("Dec");
  });

  it("draws a year before 2000", () => {
    const grid = dayHeatmap([{ day: "1987-06-30", count: 4 }], 1987, 1, TODAY);

    expect(grid.cells).toHaveLength(365);
    expect(defined(grid.cells.find(cell => cell.day === "1987-06-30"))).toMatchObject({ count: 4, level: 4 });
  });

  it("drops days that are no calendar day and empties on no year", () => {
    const grid = dayHeatmap([{ day: "2024-13-40", count: 3 }], 2024, 1, TODAY);
    expect(grid.cells.every(cell => cell.count === 0)).toBe(true);
    expect(dayHeatmap([], Number.NaN).cells).toHaveLength(0);
  });

  it("names the month over the column that holds its first day", () => {
    const grid = dayHeatmap([{ day: "2024-03-06", count: 1 }], 2024, 1, TODAY);

    const march = defined(grid.monthTicks.find(tick => tick.text === "Mar"));
    const marchFirst = defined(grid.cells.find(cell => cell.day === "2024-03-01"));
    expect(march.column).toBe(marchFirst.column);
    expect(defined(grid.monthTicks[0])).toEqual({ column: 0, text: "Jan" });
  });

  it("levels the days against the year drawn, not a busier year before it", () => {
    const busyYear = Array.from({ length: 20 }, (_, index) => ({
      day: `2022-03-${String(index + 1).padStart(2, "0")}`,
      count: 500,
    }));
    const quietYear = [
      { day: "2023-05-01", count: 1 },
      { day: "2023-05-02", count: 2 },
      { day: "2023-05-03", count: 3 },
      { day: "2023-05-04", count: 9 },
    ];
    const grid = dayHeatmap([...busyYear, ...quietYear], 2023, 1, TODAY);
    const levels = quietYear.map(({ day }) => defined(grid.cells.find(cell => cell.day === day)).level);

    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it("gives the busiest day of a sparse year the deepest shade", () => {
    const grid = dayHeatmap(
      [
        { day: "2023-05-01", count: 1 },
        { day: "2023-05-02", count: 1 },
        { day: "2023-05-03", count: 1 },
        { day: "2023-05-04", count: 1 },
        { day: "2023-05-05", count: 2 },
      ],
      2023,
      1,
      TODAY
    );
    const level = (day: string) => defined(grid.cells.find(cell => cell.day === day)).level;

    expect(level("2023-05-05")).toBe(4);
    expect(level("2023-05-01")).toBe(1);
    expect(
      dayHeatmap([{ day: "2023-06-01", count: 1 }], 2023, 1, TODAY).cells.find(cell => cell.count > 0)?.level
    ).toBe(4);
  });
});

describe("photoYears", () => {
  it("lists the years with photos, latest first", () => {
    expect(
      photoYears([
        { day: "1999-12-31", count: 2 },
        { day: "2024-01-04", count: 1 },
        { day: "2024-05-04", count: 3 },
        { day: "2010-02-02", count: 0 },
        { day: "not-a-day", count: 1 },
      ])
    ).toEqual([2024, 1999]);
    expect(photoYears([])).toEqual([]);
  });
});

describe("levels", () => {
  it("splits the nonzero counts at their quartiles", () => {
    const quartiles = countQuartiles([1, 1, 1, 4, 4, 4, 8, 8, 16]);
    expect(quartiles).toEqual([1, 4, 8]);
    expect(dayLevel(0, quartiles, 16)).toBe(0);
    expect(dayLevel(1, quartiles, 16)).toBe(1);
    expect(dayLevel(4, quartiles, 16)).toBe(2);
    expect(dayLevel(8, quartiles, 16)).toBe(3);
    expect(dayLevel(16, quartiles, 16)).toBe(4);
  });

  it("gives every day the deepest shade when the counts are alike", () => {
    expect(dayLevel(5, countQuartiles([5, 5, 5]), 5)).toBe(4);
  });
});

describe("cell size", () => {
  it("keeps a tappable cell on a narrow card and grows to the maximum on a wide one", () => {
    expect(dayCellPx(360, 53)).toBe(DAY_CELL_PX.min);
    expect(dayCellPx(2000, 53)).toBe(DAY_CELL_PX.max);
    expect(dayCellPx(1200, 53)).toBe(19);
    expect(dayGridWidth(53, DAY_CELL_PX.min)).toBeGreaterThan(360);
  });
});
