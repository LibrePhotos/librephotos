import { Media, type DatePhotosGroup, type PigPhoto } from "@librephotos/api-client";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { ageAt, ageNote, ageToday, photosBefore } from "./personAge";

const day = (year: number, month: number, dayOfMonth: number) => ({ year, month, day: dayOfMonth });

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ageAt", () => {
  it("is a year older on the birthday, not the day before", () => {
    expect(ageAt("2019-05-03", day(2025, 5, 2))?.years).toBe(5);
    expect(ageAt("2019-05-03", day(2025, 5, 3))?.years).toBe(6);
  });

  it("turns a 29 February birthday a year older on 1 March in other years", () => {
    expect(ageAt("2020-02-29", day(2021, 2, 28))?.years).toBe(0);
    expect(ageAt("2020-02-29", day(2021, 3, 1))?.years).toBe(1);
    expect(ageAt("2020-02-29", day(2024, 2, 29))?.years).toBe(4);
  });

  it("is zero on the day of birth", () => {
    expect(ageAt("2019-05-03", day(2019, 5, 3))).toEqual({ years: 0, months: 0, days: 0 });
  });

  it("counts whole months and days for a baby", () => {
    expect(ageAt("2019-05-03", day(2019, 9, 2))).toEqual({ years: 0, months: 3, days: 122 });
    expect(ageAt("2019-01-31", day(2019, 2, 28))).toEqual({ years: 0, months: 0, days: 28 });
  });

  it("is nothing before the birth, or for a date that is no day", () => {
    expect(ageAt("2019-05-03", day(2019, 5, 2))).toBeNull();
    expect(ageAt("2019-02-30", day(2020, 1, 1))).toBeNull();
  });
});

describe("the age labels", () => {
  it.each([
    [{ years: 6, months: 73, days: 2234 }, "Age 6", "6 years old"],
    [{ years: 1, months: 12, days: 366 }, "Age 1", "1 year old"],
    [{ years: 0, months: 4, days: 127 }, "4 months", "4 months old"],
    [{ years: 0, months: 0, days: 1 }, "1 day", "1 day old"],
    [{ years: 0, months: 0, days: 0 }, "Newborn", "Newborn"],
  ])("%o is %s on a day and %s today", (age, note, today) => {
    expect(ageNote(i18n.t, age)).toBe(note);
    expect(ageToday(i18n.t, age)).toBe(today);
  });
});

describe("photosBefore", () => {
  const tile = (id: string): PigPhoto => ({
    id,
    image_hash: id,
    aspectRatio: 1,
    type: Media.IMAGE,
    is_hdr: false,
    rating: 0,
    shared_to: [],
    isTemp: false,
    has_raw_variant: false,
  });
  const group = (date: string | null, count: number): DatePhotosGroup => ({
    date,
    location: null,
    items: Array.from({ length: count }, (_, index): PigPhoto => tile(String(index))),
  });

  it("counts the photos of the days before the birth date, not undated ones", () => {
    const groups = [
      group("2025-06-14T10:00:00Z", 3),
      group("2019-05-03T08:00:00Z", 2),
      group("2018-02-12T10:00:00Z", 4),
      group(null, 5),
    ];

    expect(photosBefore(groups, "2019-05-03")).toBe(4);
    expect(photosBefore(groups, "2010-01-01")).toBe(0);
  });
});
