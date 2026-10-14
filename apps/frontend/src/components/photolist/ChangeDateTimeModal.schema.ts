import type { DateTimeChange } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { z } from "zod";
import { pickerDateToPhotoTimestamp } from "../../util/dateUtils";
import { combineDayAndTime, WHOLE_TIME } from "../lightbox/TimestampForm.schema";

/** Shift moves every photo by one amount; Set gives them all one date and time. */
type DateTimeMode = DateTimeChange["mode"];
export type ShiftDirection = "earlier" | "later";

/** What a NumberInput reports: a number, or "" while it is empty. */
type NumberField = number | string;

export type ChangeDateTimeValues = {
  mode: DateTimeMode;
  direction: ShiftDirection;
  days: NumberField;
  hours: NumberField;
  minutes: NumberField;
  seconds: NumberField;
  /** Set: the day picked and the time typed, as the lightbox's date editor takes them. */
  day: Date | null;
  time: string;
};

export const SHIFT_UNITS = ["days", "hours", "minutes", "seconds"] as const;
type ShiftUnit = (typeof SHIFT_UNITS)[number];

const UNIT_SECONDS: Readonly<Record<ShiftUnit, number>> = { days: 86400, hours: 3600, minutes: 60, seconds: 1 };

/** The largest number each field takes: a century of days, and as much of the smaller units. */
export const UNIT_MAX: Readonly<Record<ShiftUnit, number>> = {
  days: 36500,
  hours: 876000,
  minutes: 52560000,
  seconds: 3153600000,
};

const amount = (value: NumberField) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The shift the fields describe, in seconds: negative for earlier, 0 for none. */
export function shiftSeconds(values: Pick<ChangeDateTimeValues, "direction" | ShiftUnit>): number {
  const total = SHIFT_UNITS.reduce((sum, unit) => sum + amount(values[unit]) * UNIT_SECONDS[unit], 0);
  return values.direction === "earlier" ? -total : total;
}

/** The request the form's values make, or null while they make none (no shift, no whole time). */
export function dateTimeChange(values: ChangeDateTimeValues): DateTimeChange | null {
  if (values.mode === "shift") {
    const seconds = shiftSeconds(values);
    return seconds === 0 ? null : { mode: "shift", seconds };
  }
  const picked = combineDayAndTime(values);
  const datetime = picked && pickerDateToPhotoTimestamp(picked);
  return datetime ? { mode: "set", datetime } : null;
}

const unitField = (max: number) => z.union([z.number().int().min(0).max(max), z.literal("")]);

/**
 * The bulk date dialog (#2278): Shift needs an amount other than zero, Set a day and a whole time.
 * Only the fields of the chosen mode count.
 */
export function makeChangeDateTimeSchema(t: TFunction) {
  return z
    .object({
      mode: z.enum(["shift", "set"]),
      direction: z.enum(["earlier", "later"]),
      days: unitField(UNIT_MAX.days),
      hours: unitField(UNIT_MAX.hours),
      minutes: unitField(UNIT_MAX.minutes),
      seconds: unitField(UNIT_MAX.seconds),
      day: z.date().nullable(),
      time: z.string(),
    })
    .superRefine((values, context) => {
      if (values.mode === "shift") {
        if (shiftSeconds(values) === 0) {
          context.addIssue({ code: "custom", path: ["days"], message: t("changedatetime.entershift") });
        }
        return;
      }
      if (values.day === null) {
        context.addIssue({ code: "custom", path: ["day"], message: t("changedatetime.pickdatetime") });
      }
      if (!WHOLE_TIME.test(values.time)) {
        context.addIssue({ code: "custom", path: ["time"], message: t("lightbox.sidebar.timeincomplete") });
      }
    });
}
