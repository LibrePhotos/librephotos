import { describe, expect, test } from "vitest";
import { Memory, MemoryType } from "../../api_client/memories";
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
} as Memory;

const monthMemory = { ...dayMemory, type: MemoryType.MONTH_YEARS_AGO, date: "2019-08-03" } as Memory;

describe("memoryMonthLabel", () => {
  test("names a month memory by its month", () => {
    expect(memoryMonthLabel(monthMemory, "en")).toBe("August 2019");
  });

  test("leaves a day memory to the caller", () => {
    expect(memoryMonthLabel(dayMemory, "en")).toBeNull();
  });

  test("follows the interface language", () => {
    expect(memoryMonthLabel(monthMemory, "de")).toBe("August 2019");
    expect(memoryMonthLabel({ ...monthMemory, date: "2019-05-03" } as Memory, "de")).toBe("Mai 2019");
  });
});

describe("memoryDayLabel", () => {
  test("spells out the day of a day memory", () => {
    expect(memoryDayLabel(dayMemory, "en")).toBe("Aug 24, 2019");
  });

  test("says nothing for a month memory, which is already named by its month", () => {
    expect(memoryDayLabel(monthMemory, "en")).toBeNull();
  });

  test("degrades to no label rather than to Invalid DateTime", () => {
    expect(memoryDayLabel({ ...dayMemory, date: "not-a-date" } as Memory, "en")).toBeNull();
  });
});
