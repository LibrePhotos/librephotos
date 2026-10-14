import { Settings } from "luxon";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  describeDuration,
  firstDayOfWeek,
  formatPhotoDateTime,
  fromPickerValue,
  fromUnixSeconds,
  parseInstant,
  parsePhotoTimestamp,
  parsePickerDate,
  photoTimestampToPickerDate,
  pickerDateToPhotoTimestamp,
  pickerValueDaysFromNow,
  shiftPhotoTimestamp,
  toPickerValue,
} from "./dateUtils";
import { defined } from "./defined.test-utils";

const originalZone = Settings.defaultZone;
const originalLocale = Settings.defaultLocale;
const originalNow = Settings.now;

afterEach(() => {
  Settings.defaultZone = originalZone;
  Settings.defaultLocale = originalLocale;
  Settings.now = originalNow;
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
    expect(defined(date).getFullYear()).toBe(2023);
    expect(defined(date).getMonth()).toBe(8);
    expect(defined(date).getDate()).toBe(21);
    expect(defined(date).getHours()).toBe(14);
    expect(defined(date).getMinutes()).toBe(30);
    expect(defined(date).getSeconds()).toBe(15);
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
    expect(defined(parsed).getFullYear()).toBe(2023);
    expect(defined(parsed).getMonth()).toBe(8);
    expect(defined(parsed).getDate()).toBe(21);
  });

  test("passes a Date through unchanged", () => {
    const date = new Date(2023, 8, 21, 14, 30);
    expect(defined(parsePickerDate(date)).getTime()).toBe(date.getTime());
  });

  test("returns null for unusable input", () => {
    expect(parsePickerDate("not a date")).toBeNull();
    // eslint-disable-next-line ban/date-constructor -- an invalid Date is the input under test
    expect(parsePickerDate(new Date(Number.NaN))).toBeNull();
  });
});

describe("pickerDateToPhotoTimestamp", () => {
  test("round-trips a timestamp unchanged", () => {
    const timestamp = "2023-09-21T14:30:15.000Z";
    expect(pickerDateToPhotoTimestamp(defined(photoTimestampToPickerDate(timestamp)))).toBe(timestamp);
  });

  test("stores the wall clock the user picked, not a converted instant", () => {
    // The user picks 09:00 in the time input; that is what should be stored.
    const picked = new Date(2023, 8, 21, 9, 0, 0);
    expect(pickerDateToPhotoTimestamp(picked)).toBe("2023-09-21T09:00:00.000Z");
  });

  test("returns null for an invalid Date", () => {
    // eslint-disable-next-line ban/date-constructor -- an invalid Date is the input under test
    expect(pickerDateToPhotoTimestamp(new Date(Number.NaN))).toBeNull();
  });
});

describe("parseInstant", () => {
  test("reads an instant in the viewer's zone", () => {
    Settings.defaultZone = "Asia/Kolkata";
    const parsed = parseInstant("2023-09-21T14:30:00Z");
    expect(parsed.isValid).toBe(true);
    expect([parsed.hour, parsed.minute]).toEqual([20, 0]);
  });

  test("keeps the same instant in every zone", () => {
    zones.forEach(zone => {
      Settings.defaultZone = zone;
      expect(parseInstant("2023-09-21T14:30:00Z").toMillis()).toBe(Date.UTC(2023, 8, 21, 14, 30));
    });
  });

  test("formats month names in the default locale", () => {
    const march = "2024-03-15T10:00:00Z";
    Settings.defaultLocale = "de";
    expect(parseInstant(march).toLocaleString({ month: "long" })).toBe("März");
    Settings.defaultLocale = "en";
    expect(parseInstant(march).toLocaleString({ month: "long" })).toBe("March");
  });

  test("keeps the wall clock of a DST boundary instant", () => {
    // Berlin springs forward on 2023-03-26 at 02:00 CET, so 01:30Z is 03:30 CEST.
    Settings.defaultZone = "Europe/Berlin";
    const before = parseInstant("2023-03-26T00:59:59Z");
    const after = parseInstant("2023-03-26T01:30:00Z");
    expect([before.hour, before.minute]).toEqual([1, 59]);
    expect([after.hour, after.minute]).toEqual([3, 30]);
    expect(after.offset).toBe(120);
  });

  test("flags an unparseable timestamp as invalid", () => {
    expect(parseInstant("not a timestamp").isValid).toBe(false);
  });
});

describe("fromUnixSeconds", () => {
  test("reads seconds since the epoch as an instant", () => {
    Settings.defaultZone = "UTC";
    expect(fromUnixSeconds(1695306600).toISO()).toBe("2023-09-21T14:30:00.000Z");
  });

  test("uses the viewer's zone for the wall clock", () => {
    Settings.defaultZone = "Europe/Moscow";
    expect(fromUnixSeconds(1695306600).hour).toBe(17);
  });
});

describe("toPickerValue", () => {
  test("shows the stored instant as the viewer's local wall clock", () => {
    Settings.defaultZone = "Europe/Moscow";
    expect(toPickerValue("2023-09-21T14:30:00.000Z")).toBe("2023-09-21 17:30:00");
  });

  test("shows the wall clock across a DST boundary", () => {
    Settings.defaultZone = "Europe/Berlin";
    expect(toPickerValue("2023-03-26T01:30:00.000Z")).toBe("2023-03-26 03:30:00");
  });

  test("returns an empty value for an unparseable timestamp", () => {
    expect(toPickerValue("nope")).toBe("");
  });
});

describe("fromPickerValue", () => {
  test("turns the picked local wall clock into a UTC instant", () => {
    Settings.defaultZone = "Europe/Moscow";
    expect(fromPickerValue("2023-09-21 17:30:00")).toBe("2023-09-21T14:30:00.000Z");
  });

  test("converts a DST-boundary wall clock with the offset in force then", () => {
    Settings.defaultZone = "Europe/Berlin";
    expect(fromPickerValue("2023-03-26 03:30:00")).toBe("2023-03-26T01:30:00.000Z");
  });

  test("round-trips with toPickerValue", () => {
    Settings.defaultZone = "America/New_York";
    const iso = "2023-07-01T12:00:00.000Z";
    expect(fromPickerValue(toPickerValue(iso))).toBe(iso);
  });

  test("returns null for a value that does not parse", () => {
    expect(fromPickerValue("")).toBeNull();
    expect(fromPickerValue("21 September")).toBeNull();
  });
});

describe("pickerValueDaysFromNow", () => {
  test("adds calendar days in the viewer's zone, keeping the wall clock across DST", () => {
    Settings.defaultZone = "Europe/Berlin";
    // 2023-03-25 12:30 CET (11:30Z), the day before the clocks change.
    Settings.now = () => Date.UTC(2023, 2, 25, 11, 30);
    expect(pickerValueDaysFromNow(1)).toBe("2023-03-26 12:30:00");
    expect(pickerValueDaysFromNow(7)).toBe("2023-04-01 12:30:00");
  });
});

describe("firstDayOfWeek", () => {
  test.each([
    ["en-US", 0],
    ["de-DE", 1],
    ["ar-EG", 6],
  ])("starts the week of %s on day %i", (locale, expected) => {
    Settings.defaultLocale = locale;
    expect(firstDayOfWeek()).toBe(expected);
  });

  // Browsers without Intl.Locale week info (older Firefox) get Luxon's
  // fallback, which keeps Mantine's old Monday start.
  test("falls back to Monday without Intl.Locale week info", () => {
    vi.stubGlobal("Intl", Object.create(Intl, { Locale: { value: function Locale() {} } }));
    try {
      Settings.defaultLocale = "en-US";
      expect(firstDayOfWeek()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("shifting and describing photo dates (#2278)", () => {
  test("a shift keeps the wall clock, whatever the viewer's zone", () => {
    Settings.defaultZone = "America/New_York";
    expect(shiftPhotoTimestamp("2025-10-09T08:14:02Z", -3600)).toBe("2025-10-09T07:14:02.000Z");
    expect(shiftPhotoTimestamp("2025-10-09T23:30:00Z", 3600)).toBe("2025-10-10T00:30:00.000Z");
  });

  test("an unreadable date shifts to null", () => {
    expect(shiftPhotoTimestamp("not a date", 60)).toBeNull();
  });

  test("the wall clock is formatted to the second", () => {
    Settings.defaultZone = "Asia/Tokyo";
    Settings.defaultLocale = "en-US";
    // ICU puts a narrow no-break space before "AM".
    expect(formatPhotoDateTime("2025-10-09T08:14:02Z")).toMatch(/^Oct 9, 2025, 8:14:02\sAM$/);
  });

  test("a duration names only its non-zero units, and overflow carries", () => {
    Settings.defaultLocale = "en-US";
    expect(describeDuration(5400)).toBe("1 hour, 30 minutes");
    expect(describeDuration(-93600)).toBe("1 day, 2 hours");
    expect(describeDuration(61)).toBe("1 minute, 1 second");
  });
});
