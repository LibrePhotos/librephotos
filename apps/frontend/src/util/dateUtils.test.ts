import { Settings } from "luxon";
import { afterEach, describe, expect, test } from "vitest";
import {
  parsePhotoTimestamp,
  parsePickerDate,
  photoTimestampToPickerDate,
  pickerDateToPhotoTimestamp,
} from "./dateUtils";

const originalZone = Settings.defaultZone;

afterEach(() => {
  Settings.defaultZone = originalZone;
});

// The bug in #1025: a viewer in UTC+3 saw every photo shifted three hours
// forward, and no date rule change could correct it. These zones bracket that
// case on both sides of UTC.
const zones = ["UTC", "Europe/Moscow", "America/New_York", "Asia/Kolkata"];

describe("parsePhotoTimestamp", () => {
  test("returns the recorded wall clock whatever zone the viewer is in", () => {
    zones.forEach(zone => {
      Settings.defaultZone = zone;
      const parsed = parsePhotoTimestamp("2023-09-21T14:30:00Z");
      expect(parsed.isValid).toBe(true);
      expect([parsed.year, parsed.month, parsed.day]).toEqual([2023, 9, 21]);
      expect([parsed.hour, parsed.minute]).toEqual([14, 30]);
    });
  });

  test("does not roll the date over near midnight", () => {
    Settings.defaultZone = "Europe/Moscow";
    const parsed = parsePhotoTimestamp("2023-09-21T23:30:00Z");
    expect(parsed.day).toBe(21);
    expect(parsed.hour).toBe(23);
  });

  test("flags an unparseable timestamp as invalid", () => {
    expect(parsePhotoTimestamp("not a timestamp").isValid).toBe(false);
  });
});

describe("photoTimestampToPickerDate", () => {
  test("exposes the wall clock through the Date's local getters", () => {
    const date = photoTimestampToPickerDate("2023-09-21T14:30:15Z");
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2023);
    expect(date!.getMonth()).toBe(8);
    expect(date!.getDate()).toBe(21);
    expect(date!.getHours()).toBe(14);
    expect(date!.getMinutes()).toBe(30);
    expect(date!.getSeconds()).toBe(15);
  });

  test("returns null for an unparseable timestamp", () => {
    expect(photoTimestampToPickerDate("nope")).toBeNull();
  });
});

describe("parsePickerDate", () => {
  test("keeps the calendar day the user clicked", () => {
    // `new Date("2023-09-21")` resolves to UTC midnight, which is still the
    // 20th anywhere west of UTC.
    const parsed = parsePickerDate("2023-09-21");
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2023);
    expect(parsed!.getMonth()).toBe(8);
    expect(parsed!.getDate()).toBe(21);
  });

  test("passes a Date through unchanged", () => {
    const date = new Date(2023, 8, 21, 14, 30);
    expect(parsePickerDate(date)!.getTime()).toBe(date.getTime());
  });

  test("returns null for unusable input", () => {
    expect(parsePickerDate("not a date")).toBeNull();
    expect(parsePickerDate(new Date(Number.NaN))).toBeNull();
  });
});

describe("pickerDateToPhotoTimestamp", () => {
  test("round-trips a timestamp unchanged", () => {
    const timestamp = "2023-09-21T14:30:15.000Z";
    expect(pickerDateToPhotoTimestamp(photoTimestampToPickerDate(timestamp)!)).toBe(timestamp);
  });

  test("stores the wall clock the user picked, not a converted instant", () => {
    // The user picks 09:00 in the time input; that is what should be stored.
    const picked = new Date(2023, 8, 21, 9, 0, 0);
    expect(pickerDateToPhotoTimestamp(picked)).toBe("2023-09-21T09:00:00.000Z");
  });

  test("returns null for an invalid Date", () => {
    expect(pickerDateToPhotoTimestamp(new Date(Number.NaN))).toBeNull();
  });
});
