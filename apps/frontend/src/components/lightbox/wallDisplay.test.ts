import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_DISPLAY_SETTINGS,
  DRIFT_MAX_PX,
  inSleepWindow,
  randomDriftOffset,
  WallDisplaySettings,
} from "./wallDisplay";

const at = (hours: number, minutes = 0) => new Date(2026, 5, 15, hours, minutes);

describe("inSleepWindow", () => {
  it("sleeps inside a same-day window and not outside it", () => {
    expect(inSleepWindow(at(13, 0), "12:00", "14:00")).toBe(true);
    expect(inSleepWindow(at(11, 59), "12:00", "14:00")).toBe(false);
    expect(inSleepWindow(at(14, 0), "12:00", "14:00")).toBe(false);
  });

  it("wraps an overnight window over midnight", () => {
    expect(inSleepWindow(at(23, 30), "23:00", "07:00")).toBe(true);
    expect(inSleepWindow(at(2, 0), "23:00", "07:00")).toBe(true);
    expect(inSleepWindow(at(6, 59), "23:00", "07:00")).toBe(true);
    expect(inSleepWindow(at(7, 0), "23:00", "07:00")).toBe(false);
    expect(inSleepWindow(at(12, 0), "23:00", "07:00")).toBe(false);
    expect(inSleepWindow(at(22, 59), "23:00", "07:00")).toBe(false);
  });

  it("treats a window whose start equals its end as off", () => {
    expect(inSleepWindow(at(3, 0), "00:00", "00:00")).toBe(false);
    expect(inSleepWindow(at(15, 0), "15:00", "15:00")).toBe(false);
  });

  it("treats a malformed time as off rather than sleeping all day", () => {
    expect(inSleepWindow(at(3, 0), "", "07:00")).toBe(false);
    expect(inSleepWindow(at(3, 0), "23:00", "25:00")).toBe(false);
    expect(inSleepWindow(at(3, 0), "late", "07:00")).toBe(false);
  });
});

describe("randomDriftOffset", () => {
  it("stays within the maximum shift", () => {
    for (let i = 0; i < 200; i += 1) {
      const offset = randomDriftOffset();
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(DRIFT_MAX_PX);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(DRIFT_MAX_PX);
    }
  });

  it("follows the given random source", () => {
    expect(randomDriftOffset(() => 0)).toEqual({ x: -DRIFT_MAX_PX, y: -DRIFT_MAX_PX });
    expect(randomDriftOffset(() => 1)).toEqual({ x: DRIFT_MAX_PX, y: DRIFT_MAX_PX });
  });
});

describe("WallDisplaySettings", () => {
  it("leaves an ordinary slideshow as it was: no drift, the cursor shown, sleep off", () => {
    expect(DEFAULT_WALL_DISPLAY_SETTINGS).toMatchObject({
      burnInProtection: false,
      hideCursor: false,
      sleepEnabled: false,
    });
    expect(WallDisplaySettings.parse({})).toEqual(DEFAULT_WALL_DISPLAY_SETTINGS);
  });

  it("keeps the fields it can read when one is corrupt", () => {
    const parsed = WallDisplaySettings.parse({
      ...DEFAULT_WALL_DISPLAY_SETTINGS,
      sleepEnabled: true,
      sleepStart: "not a time",
    });
    expect(parsed.sleepEnabled).toBe(true);
    expect(parsed.sleepStart).toBe("23:00");
  });

  it("rejects a value that is not its shape at all", () => {
    expect(WallDisplaySettings.safeParse("wall display").success).toBe(false);
    expect(WallDisplaySettings.safeParse(null).success).toBe(false);
  });
});
