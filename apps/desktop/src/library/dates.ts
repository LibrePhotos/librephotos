/** Library dates are local wall-clock milliseconds, so they are read with the UTC getters. */
const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

const monthCache = new Map<number, string>();

/** "March 2023" (memoised per month: the grid asks for every file). */
export function monthLabel(wallMs: number): string {
  const d = new Date(wallMs);
  const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
  let label = monthCache.get(key);
  if (label === undefined) {
    label = month.format(d);
    monthCache.set(key, label);
  }
  return label;
}

export function dayLabel(wallMs: number): string {
  return day.format(new Date(wallMs));
}
