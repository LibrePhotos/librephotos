import type { Memory } from "@librephotos/api-client";
import { MemoryType } from "@librephotos/api-client";
import { parseInstant } from "../../util/dateUtils";

/** What the labels read off a memory. */
type DatedMemory = Readonly<Pick<Memory, "type" | "date">>;

/**
 * A month memory names itself by its month ("August 2019"); a day memory is
 * named "N years ago" by the caller, which has the translations, and gives the
 * day underneath without its year, which "N years ago" already says ("Aug 24").
 * Both return null for the other kind, so the card can pick whichever applies
 * without repeating the same date twice.
 */
export function memoryMonthLabel(memory: DatedMemory): string | null {
  if (memory.type !== MemoryType.MONTH_YEARS_AGO) {
    return null;
  }
  const date = parseInstant(memory.date);
  return date.isValid ? date.toLocaleString({ month: "long", year: "numeric" }) : null;
}

export function memoryDayLabel(memory: DatedMemory): string | null {
  if (memory.type !== MemoryType.YEARS_AGO) {
    return null;
  }
  const date = parseInstant(memory.date);
  return date.isValid ? date.toLocaleString({ month: "short", day: "numeric" }) : null;
}
