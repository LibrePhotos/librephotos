import type { DatePhotosGroup } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { parseCalendarDay, parsePhotoTimestamp } from "../../util/dateUtils";

/** A calendar day: a luxon DateTime has these, and so does a birth date. */
type Day = Readonly<{ year: number; month: number; day: number }>;

/** How old someone was on a day: whole years, and the whole months and the days, all counted from the birth. */
export type Age = Readonly<{ years: number; months: number; days: number }>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber({ year, month, day }: Day): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/**
 * How old a person born on `birthDate` (`YYYY-MM-DD`) was on the day `at` (#2751): null when the
 * birth date is no day or `at` is before it. A year or a month is over on the birth day's date, so
 * someone born on 29 February turns a year older on 1 March in other years.
 */
export function ageAt(birthDate: string, at: Day): Age | null {
  const born = parseCalendarDay(birthDate);
  if (!born.isValid) return null;
  const days = dayNumber(at) - dayNumber(born);
  if (days < 0) return null;
  const months = (at.year - born.year) * 12 + at.month - born.month - (at.day < born.day ? 1 : 0);
  return { years: Math.floor(months / 12), months, days };
}

type AgeUnit = "years" | "months" | "days" | "newborn";

// The largest unit that is not zero; the day of birth itself is "newborn".
function ageUnit(age: Age): [AgeUnit, number] {
  if (age.years > 0) return ["years", age.years];
  if (age.months > 0) return ["months", age.months];
  if (age.days > 0) return ["days", age.days];
  return ["newborn", 0];
}

/** The age beside a day heading: "Age 6", "4 months", "12 days" or "Newborn". */
export function ageNote(t: TFunction, age: Age): string {
  const [unit, count] = ageUnit(age);
  return t(`personbirthdate.note.${unit}`, { count });
}

/** The age in the person page's header: "6 years old", "4 months old", "12 days old" or "Newborn". */
export function ageToday(t: TFunction, age: Age): string {
  const [unit, count] = ageUnit(age);
  return t(`personbirthdate.old.${unit}`, { count });
}

/** How many photos of the date groups were taken before `birthDate` (`YYYY-MM-DD`); undated ones are not. */
export function photosBefore(groups: readonly DatePhotosGroup[], birthDate: string): number {
  return groups
    .filter(group => {
      const day = group.date === null ? null : parsePhotoTimestamp(group.date).toISODate();
      return day !== null && day < birthDate;
    })
    .reduce((count, group) => count + group.items.length, 0);
}
