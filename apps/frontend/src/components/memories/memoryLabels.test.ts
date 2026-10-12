import { Settings } from "luxon";
import { afterEach, describe, expect, test } from "vitest";
import type { Memory } from "../../api_client/memories";
import { MemoryType } from "../../api_client/memories";
import { memoryDayLabel, memoryMonthLabel } from "./memoryLabels";

/**
 * The backend deliberately sends no titles -- it has no translations -- so the
 * card composes them. A day memory is named "N years ago" (by the caller) and
 * shows its day; a month memory is named by its month and shows nothing extra.
 */
const dayMemory = {
  id: "years_ago-2019",
  type: MemoryType.YEARS_AGO,
  years_ago: 7,
  year: 2019,
  date: "2019-08-24",
  start_date: "2019-08-22",
  end_date: "2019-08-24",
  location: "",
  numberOfItems: 3,
} satisfies Omit<Memory, "cover" | "items">;

const monthMemory = { ...dayMemory, type: MemoryType.MONTH_YEARS_AGO, date: "2019-08-03" };

const originalLocale = Settings.defaultLocale;

afterEach(() => {
  Settings.defaultLocale = originalLocale;
});

describe("memoryMonthLabel", () => {
  test("names a month memory by its month", () => {
    Settings.defaultLocale = "en";
    expect(memoryMonthLabel(monthMemory)).toBe("August 2019");
  });

  test("leaves a day memory to the caller", () => {
    expect(memoryMonthLabel(dayMemory)).toBeNull();
  });

  test("follows the interface language", () => {
    Settings.defaultLocale = "de";
    expect(memoryMonthLabel(monthMemory)).toBe("August 2019");
    expect(memoryMonthLabel({ ...monthMemory, date: "2019-05-03" })).toBe("Mai 2019");
  });
});

describe("memoryDayLabel", () => {
  test("spells out the day of a day memory", () => {
    Settings.defaultLocale = "en";
    expect(memoryDayLabel(dayMemory)).toBe("Aug 24, 2019");
  });

  test("says nothing for a month memory, which is already named by its month", () => {
    expect(memoryDayLabel(monthMemory)).toBeNull();
  });

  test("degrades to no label rather than to Invalid DateTime", () => {
    expect(memoryDayLabel({ ...dayMemory, date: "not-a-date" })).toBeNull();
  });
});
