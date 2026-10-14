import type { SearchFilters } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { formatCalendarDay } from "../../util/dateUtils";
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
    return new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  } catch {
    // An unknown language tag
    return new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
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
  }
}

function rangeChip(field: RangeField, filters: SearchFilters, ctx: ChipContext): SearchFilterChip | undefined {
  const low = filters[field.min];
  const high = filters[field.max];
  const name = ctx.t(field.labelKey);
  const patch: SearchFilters = {};
  patch[field.min] = undefined;
  patch[field.max] = undefined;
  const id = field.id;
  if (low !== undefined && high !== undefined) {
    const label = ctx.t("searchfilter.chip.between", {
      name,
      low: formatRangeValue(field, low, ctx),
      high: formatRangeValue(field, high, ctx),
    });
    return { id, label, patch };
  }
  if (low !== undefined) {
    return { id, label: ctx.t("searchfilter.chip.atleast", { name, low: formatRangeValue(field, low, ctx) }), patch };
  }
  if (high !== undefined) {
    return { id, label: ctx.t("searchfilter.chip.atmost", { name, high: formatRangeValue(field, high, ctx) }), patch };
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
