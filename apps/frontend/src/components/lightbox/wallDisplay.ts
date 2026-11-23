import { z } from "zod";

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WallDisplaySettings = z.object({
  keepAwake: z.boolean().catch(true),
  hideCursor: z.boolean().catch(false),
  burnInProtection: z.boolean().catch(false),
  sleepEnabled: z.boolean().catch(false),
  sleepStart: TimeOfDay.catch("23:00"),
  sleepEnd: TimeOfDay.catch("07:00"),
});

export type WallDisplaySettings = z.infer<typeof WallDisplaySettings>;

export const DEFAULT_WALL_DISPLAY_SETTINGS: WallDisplaySettings = {
  keepAwake: true,
  hideCursor: false,
  burnInProtection: false,
  sleepEnabled: false,
  sleepStart: "23:00",
  sleepEnd: "07:00",
};

export type DriftOffset = Readonly<{ x: number; y: number }>;

export const DRIFT_MAX_PX = 20;
export const DRIFT_EVERY_MS = 120_000;
export const CURSOR_IDLE_MS = 3_000;
export const SLEEP_CHECK_EVERY_MS = 30_000;

export function randomDriftOffset(random: () => number = Math.random): DriftOffset {
  return {
    x: Math.round((random() * 2 - 1) * DRIFT_MAX_PX),
    y: Math.round((random() * 2 - 1) * DRIFT_MAX_PX),
  };
}

function minutesAfterMidnight(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function inSleepWindow(now: Date, sleepStart: string, sleepEnd: string): boolean {
  const start = minutesAfterMidnight(sleepStart);
  const end = minutesAfterMidnight(sleepEnd);
  if (start === null || end === null || start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}
