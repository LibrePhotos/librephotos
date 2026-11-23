import type { SearchFilters } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { formatCalendarDay } from "../../util/dateUtils";
import { formatExposureValue } from "../../util/exifFormat";
import { RANGE_FIELDS, type RangeField } from "./searchFilterRanges";

// The chips under the search title: one sentence per active filter ("ISO 3,200 or more",
// "With Anna"), each with the patch that removes it.

export type SearchFilterChip = {
  id: string;
  label: string;
  /** Applied to the URL's filters, it removes this one. */
  patch: SearchFilters;
  /** A person chip shows the face. */
  personId?: number;
};

export type ChipContext = {
  t: TFunction;
  language: string;
  /** A person's name, once the people have loaded. */
  personName: (id: number) => string | undefined;
  /** The user's favorite threshold when they rate with the favorite toggle (#2601), else undefined. */
  favoriteRating: number | undefined;
};

function numberFormat(language: string) {
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  } catch {
    // An unknown language tag
    return new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
  }
}

/** One end of a range as people read it: "3,200", "f/1.4", "23 mm". */
export function formatRangeValue(field: RangeField, value: number, ctx: Pick<ChipContext, "t" | "language">): string {
  const number = numberFormat(ctx.language).format(value);
  switch (field.unit) {
    case "plain":
      return number;
    case "fnumber":
      return ctx.t("searchfilter.unit.fnumber", { value: number });
    case "mm":
      return ctx.t("searchfilter.unit.mm", { value: number });
    case "seconds":
      return ctx.t("searchfilter.unit.seconds", { value: formatExposureValue(value, ctx.language) });
  }
}

type RangeWording = Readonly<{
  between: "searchfilter.chip.between" | "searchfilter.chip.betweenseconds";
  atleast: "searchfilter.chip.atleast" | "searchfilter.chip.longer";
  atmost: "searchfilter.chip.atmost" | "searchfilter.chip.faster";
}>;

const AMOUNT_CHIPS: RangeWording = {
  between: "searchfilter.chip.between",
  atleast: "searchfilter.chip.atleast",
  atmost: "searchfilter.chip.atmost",
};

const SPEED_CHIPS: RangeWording = {
  between: "searchfilter.chip.betweenseconds",
  atleast: "searchfilter.chip.longer",
  atmost: "searchfilter.chip.faster",
};

export function formatRangeEnds(
  field: RangeField,
  low: number,
  high: number,
  ctx: Pick<ChipContext, "t" | "language">
): Readonly<{ low: string; high: string }> {
  if (field.unit !== "seconds")
    return { low: formatRangeValue(field, low, ctx), high: formatRangeValue(field, high, ctx) };
  return { low: formatExposureValue(low, ctx.language), high: formatExposureValue(high, ctx.language) };
}

function rangeChip(field: RangeField, filters: SearchFilters, ctx: ChipContext): SearchFilterChip | undefined {
  const low = filters[field.min];
  const high = filters[field.max];
  const name = ctx.t(field.labelKey);
  const patch: SearchFilters = {};
  patch[field.min] = undefined;
  patch[field.max] = undefined;
  const id = field.id;
  const wording = field.unit === "seconds" ? SPEED_CHIPS : AMOUNT_CHIPS;
  if (low !== undefined && low === high) {
    return { id, label: ctx.t("searchfilter.chip.equals", { name, value: formatRangeValue(field, low, ctx) }), patch };
  }
  if (low !== undefined && high !== undefined) {
    const label = ctx.t(wording.between, { name, ...formatRangeEnds(field, low, high, ctx) });
    return { id, label, patch };
  }
  if (low !== undefined) {
    return { id, label: ctx.t(wording.atleast, { name, low: formatRangeValue(field, low, ctx) }), patch };
  }
  if (high !== undefined) {
    return { id, label: ctx.t(wording.atmost, { name, high: formatRangeValue(field, high, ctx) }), patch };
  }
  return undefined;
}

function takenChip(filters: SearchFilters, t: TFunction): SearchFilterChip | undefined {
  const { taken_after: after, taken_before: before } = filters;
  const patch = { taken_after: undefined, taken_before: undefined };
  if (after && before) {
    const label = t("searchfilter.chip.takenbetween", {
      after: formatCalendarDay(after),
      before: formatCalendarDay(before),
    });
    return { id: "taken", label, patch };
  }
  if (after) return { id: "taken", label: t("searchfilter.chip.takenafter", { day: formatCalendarDay(after) }), patch };
  if (before) {
    return { id: "taken", label: t("searchfilter.chip.takenbefore", { day: formatCalendarDay(before) }), patch };
  }
  return undefined;
}

function ratingChip(rating: number | undefined, ctx: ChipContext): SearchFilterChip | undefined {
  if (rating === undefined) return undefined;
  const label =
    ctx.favoriteRating === rating
      ? ctx.t("searchfilter.chip.favorites")
      : ctx.t("searchfilter.chip.rating", { count: rating });
  return { id: "rating", label, patch: { rating_min: undefined } };
}

function textChips(filters: SearchFilters, t: TFunction): SearchFilterChip[] {
  const chips: SearchFilterChip[] = [];
  if (filters.make) {
    chips.push({ id: "make", label: t("searchfilter.chip.make", { value: filters.make }), patch: { make: undefined } });
  }
  if (filters.camera) {
    const label = t("searchfilter.chip.camera", { value: filters.camera });
    chips.push({ id: "camera", label, patch: { camera: undefined } });
  }
  if (filters.lens) {
    chips.push({ id: "lens", label: t("searchfilter.chip.lens", { value: filters.lens }), patch: { lens: undefined } });
  }
  return chips;
}

function fileChips(filters: SearchFilters, t: TFunction): SearchFilterChip[] {
  const chips: SearchFilterChip[] = [];
  if (filters.has_location !== undefined) {
    const label = t(filters.has_location ? "searchfilter.chip.withlocation" : "searchfilter.chip.withoutlocation");
    chips.push({ id: "location", label, patch: { has_location: undefined } });
  }
  if (filters.file_type) {
    const label = t(`searchfilter.chip.filetype.${filters.file_type}`);
    chips.push({ id: "filetype", label, patch: { file_type: undefined } });
  }
  if (filters.extension) {
    const label = t("searchfilter.chip.extension", { value: filters.extension });
    chips.push({ id: "extension", label, patch: { extension: undefined } });
  }
  return chips;
}

function personChips(people: readonly number[] | undefined, ctx: ChipContext): SearchFilterChip[] {
  if (!people) return [];
  return people.map(id => {
    const rest = people.filter(other => other !== id);
    const name = ctx.personName(id);
    return {
      id: `person-${id}`,
      label: name ? ctx.t("searchfilter.chip.person", { name }) : ctx.t("searchfilter.chip.unknownperson"),
      patch: { person: rest.length > 0 ? rest : undefined },
      personId: id,
    };
  });
}

/** The chips of `filters`, in the panel's order: people, camera, exposure, rating, day, location, file. */
export function describeSearchFilters(filters: SearchFilters, ctx: ChipContext): SearchFilterChip[] {
  const ranges = RANGE_FIELDS.map(field => rangeChip(field, filters, ctx));
  return [
    ...personChips(filters.person, ctx),
    ...textChips(filters, ctx.t),
    ...ranges,
    ratingChip(filters.rating_min, ctx),
    takenChip(filters, ctx.t),
    ...fileChips(filters, ctx.t),
  ].filter(chip => chip !== undefined);
}
