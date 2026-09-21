import { DateTime } from "luxon";
import { Memory, MemoryType } from "../../api_client/memories";

/**
 * A month memory names itself by its month ("August 2019"); a day memory is
 * named "N years ago" by the caller, which has the translations, and spells the
 * day out underneath instead. Both return null for the other kind, so the card
 * can pick whichever applies without repeating the same date twice.
 */
export function memoryMonthLabel(memory: Memory, locale: string): string | null {
  if (memory.type !== MemoryType.MONTH_YEARS_AGO) {
    return null;
  }
  const date = DateTime.fromISO(memory.date).setLocale(locale);
  return date.isValid ? date.toLocaleString({ month: "long", year: "numeric" }) : null;
}

export function memoryDayLabel(memory: Memory, locale: string): string | null {
  if (memory.type !== MemoryType.YEARS_AGO) {
    return null;
  }
  const date = DateTime.fromISO(memory.date).setLocale(locale);
  return date.isValid ? date.toLocaleString(DateTime.DATE_MED) : null;
}
