import type { TFunction } from "i18next";
import { z } from "zod";

/** A whole time as a time input reports it ("" while it is empty or half typed): hours, minutes, seconds. */
export const WHOLE_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** The time of a picker date as a time input shows it ("08:14:02"), "" without a date. */
export function formatPickerTime(date: Date | null): string {
  if (!date) return "";
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => n.toString().padStart(2, "0")).join(":");
}

/** The day picked plus the time typed; null while either is missing or incomplete. */
export function combineDayAndTime({ day, time }: { day: Date | null; time: string }): Date | null {
  const match = WHOLE_TIME.exec(time);
  if (!day || !match) return null;
  const [, hours, minutes, seconds] = match;
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(hours),
    Number(minutes),
    Number(seconds ?? 0)
  );
}

/** The info panel's date editor: a day and a whole time, so an emptied time is never midnight (#2280). */
export function makeTimestampFormSchema(t: TFunction) {
  return z.object({
    day: z
      .date()
      .nullable()
      .refine(day => day !== null, t("lightbox.sidebar.pickday")),
    time: z.string().regex(WHOLE_TIME, t("lightbox.sidebar.timeincomplete")),
  });
}
