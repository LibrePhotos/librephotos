import type { EventTitleParts } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { formatEventTitle } from "./eventTitle";

function parts(overrides: Partial<EventTitleParts>): EventTitleParts {
  return {
    weekday: null,
    time_of_day: null,
    span_days: 0,
    weekend: false,
    people: [],
    places: [],
    date: "2022-01-03",
    ...overrides,
  };
}

// The cases of the backend's _english_title table (api/tests/albums/test_album_auto_title_parts.py)
// plus its title-generation tests: in English the web shows exactly the stored title.
const ENGLISH: ReadonlyArray<readonly [Partial<EventTitleParts>, string]> = [
  [{ weekday: 1, time_of_day: "morning" }, "Monday Morning"],
  [{ weekday: 7 }, "Sunday"],
  [{ weekday: 1, time_of_day: "early_morning" }, "Monday Early Morning"],
  [{ weekday: 4, time_of_day: "afternoon" }, "Thursday Afternoon"],
  [{ weekday: 6, time_of_day: "evening" }, "Saturday Evening"],
  [{ weekday: 1, span_days: 3 }, "3 days"],
  [{ weekday: 1, span_days: 2, time_of_day: "evening" }, "Monday Evening"],
  [{ weekday: 6, span_days: 8, weekend: true }, "Weekend"],
  [
    { weekday: 3, time_of_day: "afternoon", people: ["Anna"], places: ["Berlin"] },
    "Wednesday Afternoon with Anna in Berlin",
  ],
  [{ weekday: 1, span_days: 4, people: ["A", "B"], places: ["C", "D"] }, "4 days with A and B in C and D"],
  [{ weekday: 1, time_of_day: "morning", people: ["Alice", "Bob"] }, "Monday Morning with Alice and Bob"],
  [{ weekday: 1, time_of_day: "morning", places: ["Berlin", "Germany"] }, "Monday Morning in Berlin and Germany"],
  [{ weekday: 6, weekend: true, people: ["Alice"], places: ["Paris"] }, "Weekend with Alice in Paris"],
  [{ weekday: 1, places: ["Paris"] }, "Monday in Paris"],
  [{}, "Album from 2022-01-03"],
];

describe("formatEventTitle in English", () => {
  const t = i18n.getFixedT("en");

  it.each(ENGLISH)("words %j as the stored title", (overrides, expected) => {
    expect(formatEventTitle({ title: expected, title_parts: parts(overrides) }, t, "en")).toBe(expected);
  });

  it("keeps the stored title while the parts are missing", () => {
    expect(formatEventTitle({ title: "Monday Morning", title_parts: null }, t, "en")).toBe("Monday Morning");
    expect(formatEventTitle({ title: "Monday Morning" }, t, "en")).toBe("Monday Morning");
  });

  it("keeps the stored title for parts that name no day but people", () => {
    const album = { title: "with Anna", title_parts: parts({ people: ["Anna"] }) };
    expect(formatEventTitle(album, t, "en")).toBe("with Anna");
  });

  it("names the weekday from the stored number, not a date in the browser's zone", () => {
    // Sunday 23:30 in the photo's wall clock stays Sunday wherever the viewer is.
    expect(formatEventTitle({ title: "", title_parts: parts({ weekday: 7, time_of_day: "evening" }) }, t, "en")).toBe(
      "Sunday Evening"
    );
  });

  it("falls back to English list and day names for a language tag the runtime does not know", () => {
    const album = { title: "", title_parts: parts({ weekday: 2, people: ["Anna", "Ben"] }) };
    expect(formatEventTitle(album, t, "not a language")).toBe("Tuesday with Anna and Ben");
  });
});

describe("formatEventTitle in German", () => {
  // Weblate owns the real German strings; these stand in for them.
  i18n.addResourceBundle(
    "de",
    "translation",
    {
      autoalbum: {
        title: {
          weekend: "Wochenende",
          days_one: "{{count}} Tag",
          days_other: "{{count}} Tage",
          earlyMorning: "{{weekday}} früh",
          morning: "{{weekday}}morgen",
          afternoon: "{{weekday}}nachmittag",
          evening: "{{weekday}}abend",
          withPeople: "{{when}} mit {{people}}",
          inPlaces: "{{when}} in {{places}}",
          withPeopleInPlaces: "{{when}} mit {{people}} in {{places}}",
          fallback: "Album vom {{date}}",
        },
      },
    },
    true,
    true
  );
  const t = i18n.getFixedT("de");

  it.each([
    [
      { weekday: 3, time_of_day: "afternoon", people: ["Anna"], places: ["Berlin"] },
      "Mittwochnachmittag mit Anna in Berlin",
    ],
    [{ weekday: 1, span_days: 3 }, "3 Tage"],
    [{ weekday: 6, weekend: true, people: ["Anna", "Ben"] }, "Wochenende mit Anna und Ben"],
    [{ weekday: 7 }, "Sonntag"],
    [{ weekday: 1, time_of_day: "morning", places: ["Rom", "Latium"] }, "Montagmorgen in Rom und Latium"],
    [{}, "Album vom 2022-01-03"],
  ] satisfies ReadonlyArray<readonly [Partial<EventTitleParts>, string]>)("words %j as %s", (overrides, expected) => {
    expect(formatEventTitle({ title: "English", title_parts: parts(overrides) }, t, "de")).toBe(expected);
  });

  it("reads the app's underscore language codes for day names and lists", () => {
    // English strings: only the locale-dependent words change here.
    const album = { title: "", title_parts: parts({ weekday: 1, people: ["Ana", "Bia"] }) };
    expect(formatEventTitle(album, i18n.getFixedT("en"), "pt_BR")).toBe("segunda-feira with Ana e Bia");
  });
});
