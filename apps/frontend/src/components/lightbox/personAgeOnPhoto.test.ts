import { describe, expect, it } from "vitest";
import { ageOnPhoto } from "./personAgeOnPhoto";

describe("ageOnPhoto", () => {
  it("counts the years, months and days from the birth to the day of the photo", () => {
    expect(ageOnPhoto("2019-05-03", "2022-07-20T14:00:00Z")).toEqual({ years: 3, months: 38, days: 1174 });
  });

  it("reads the photo's own wall-clock day, not the viewer's time zone", () => {
    expect(ageOnPhoto("2019-05-03", "2020-05-03T23:30:00Z")?.years).toBe(1);
    expect(ageOnPhoto("2019-05-03", "2020-05-02T23:30:00Z")?.years).toBe(0);
  });

  it("calls the day of the birth newborn", () => {
    expect(ageOnPhoto("2019-05-03", "2019-05-03T08:00:00Z")).toEqual({ years: 0, months: 0, days: 0 });
  });

  it.each([
    ["no birth date", null, "2022-07-20T14:00:00Z"],
    ["an empty birth date", "", "2022-07-20T14:00:00Z"],
    ["no birth date given", undefined, "2022-07-20T14:00:00Z"],
    ["a birth date that is no day", "soon", "2022-07-20T14:00:00Z"],
    ["no photo date", "2019-05-03", null],
    ["a photo date left out", "2019-05-03", undefined],
    ["a photo date that is no date", "2019-05-03", "yesterday"],
    ["a photo older than the birth", "2019-05-03", "2018-12-31T10:00:00Z"],
  ])("gives no age for %s", (_name, birthDate, takenAt) => {
    expect(ageOnPhoto(birthDate, takenAt)).toBeNull();
  });
});
