import type { EventTimeOfDay, EventTitleParts } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { Info } from "luxon";

/** What an event title is worded from: the backend's English `title` and, once regenerated, its parts. */
export type EventTitleSource = Readonly<{ title: string; title_parts?: EventTitleParts | null }>;

/** The backend names a span of this many days or more by its length (`MULTI_DAY_SPAN`). */
const MULTI_DAY_SPAN = 3;

/** The UI language as a BCP 47 tag ("pt_BR" -> "pt-BR"), English when the runtime does not know it. */
function intlLocale(locale: string): string {
  const tag = locale.replace("_", "-");
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? "en";
  } catch {
    return "en";
  }
}

/** "Anna", "Anna and Ben": the backend sends at most two names. */
function joinList(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}

/** The day name of an ISO weekday (Monday is 1), from the stored number: never a browser-zone date. */
function weekdayName(weekday: number, locale: string): string | undefined {
  return Info.weekdays("long", { locale })[weekday - 1];
}

function weekdayWithTime(weekday: string, timeOfDay: EventTimeOfDay | null, t: TFunction): string {
  switch (timeOfDay) {
    case "early_morning":
      return t("autoalbum.title.earlyMorning", { weekday });
    case "morning":
      return t("autoalbum.title.morning", { weekday });
    case "afternoon":
      return t("autoalbum.title.afternoon", { weekday });
    case "evening":
      return t("autoalbum.title.evening", { weekday });
    case null:
      return weekday;
  }
}

/** "Weekend", "3 days" or "Monday Morning"; undefined when the parts name no day. */
function describeWhen(parts: EventTitleParts, t: TFunction, locale: string): string | undefined {
  if (parts.weekend) return t("autoalbum.title.weekend");
  if (parts.span_days >= MULTI_DAY_SPAN) return t("autoalbum.title.days", { count: parts.span_days });
  if (parts.weekday === null) return undefined;
  const weekday = weekdayName(parts.weekday, locale);
  return weekday === undefined ? undefined : weekdayWithTime(weekday, parts.time_of_day, t);
}

function withCompany(when: string, parts: EventTitleParts, t: TFunction, locale: string): string {
  const people = joinList(parts.people, locale);
  const places = joinList(parts.places, locale);
  if (parts.people.length > 0 && parts.places.length > 0) {
    return t("autoalbum.title.withPeopleInPlaces", { when, people, places });
  }
  if (parts.people.length > 0) return t("autoalbum.title.withPeople", { when, people });
  if (parts.places.length > 0) return t("autoalbum.title.inPlaces", { when, places });
  return when;
}

function hasNoContent(parts: EventTitleParts): boolean {
  return parts.weekday === null && parts.people.length === 0 && parts.places.length === 0;
}

/**
 * An event's title in the UI language (#2235). The backend stores the title in
 * English and the parts it is made of next to it; this words those parts with
 * the translations, so in English it reads exactly like `title`. Albums whose
 * parts are not stored yet (until the next event run or "Regenerate event
 * titles") keep their English `title`.
 */
export function formatEventTitle(album: EventTitleSource, t: TFunction, locale: string): string {
  const parts = album.title_parts;
  if (!parts) return album.title;
  const language = intlLocale(locale);
  const when = describeWhen(parts, t, language);
  if (when !== undefined) return withCompany(when, parts, t, language);
  // Only an album whose title failed has no day: the backend says "Album from <date>" then.
  return hasNoContent(parts) ? t("autoalbum.title.fallback", { date: parts.date }) : album.title;
}
