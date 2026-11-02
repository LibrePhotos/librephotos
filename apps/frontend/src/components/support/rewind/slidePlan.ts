import type { Rewind } from "@librephotos/api-client";

export type RewindSlideKey = "intro" | "count" | "people" | "places" | "months" | "end";

/** The slides a Rewind has: those without anything to say are left out. */
export function rewindSlides(rewind: Rewind): RewindSlideKey[] {
  const total = rewind.photo_count + rewind.video_count;
  if (total === 0) return ["intro", "end"];
  return [
    "intro",
    "count",
    ...(rewind.people.length > 0 ? (["people"] as const) : []),
    ...(rewind.place_count > 0 ? (["places"] as const) : []),
    "months",
    "end",
  ];
}

/** The month (0 = January) with the most photos, the first one on a tie. */
export function busiestMonth(months: readonly number[]): number {
  return months.reduce((best, count, month) => (count > (months[best] ?? 0) ? month : best), 0);
}

/** The month with the fewest photos, the first one on a tie. */
export function quietestMonth(months: readonly number[]): number {
  return months.reduce((best, count, month) => (count < (months[best] ?? 0) ? month : best), 0);
}

type Pace = Readonly<{ count: number; per: "day" | "week" | "month" }>;

/**
 * How often the year's photos were taken, in the largest unit that gives at least one: "11 a day",
 * "3 a week" or "2 a month"; null for fewer than one a month.
 */
export function pace(total: number, year: number): Pace | null {
  const days = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  // The unit is chosen on the exact rate, so 30 photos are "3 a month", not a rounded-up "1 a week".
  const perDay = total / days;
  if (perDay >= 1) return { count: Math.round(perDay), per: "day" };
  if (perDay * 7 >= 1) return { count: Math.round(perDay * 7), per: "week" };
  return total / 12 >= 1 ? { count: Math.round(total / 12), per: "month" } : null;
}
