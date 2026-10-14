import { FileTypeFilter, type BulkPhotoQuery, type MediaType, type SearchFilters } from "@librephotos/api-client";
import { z } from "zod";
import { isCalendarDay } from "../../util/dateUtils";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../photolist/mediaTypeFilter";

// The search page's structured filters (#2259, #329). The URL holds them under the API's own
// parameter names (`?camera=X-T5&iso_min=3200&person=[3,7]`), so a filtered search can be linked,
// and the same object goes to /api/photos/searchlist/ and, for select-all, into the bulk `query`.

/** The most people one search may ask for (the server's MAX_PEOPLE). */
const MAX_PEOPLE = 20;

// TanStack Router JSON-parses search values: a camera called "100" arrives as a number.
const text = z
  .union([z.string(), z.number()])
  .transform(value => String(value).trim())
  .pipe(z.string().min(1).max(100));
const whole = z.number().int().min(0);
const decimal = z.number().min(0);
const day = z.string().refine(isCalendarDay);
const personId = z.number().int().positive();
// One id (?person=3) or several (?person=3&person=7, or the JSON list the router writes).
const people = z
  .union([personId.transform(id => [id]), z.array(personId).min(1).max(MAX_PEOPLE)])
  .transform(ids => [...new Set(ids)]);

export type SearchFilterKey = keyof SearchFilters;

/** A patch that removes every filter (and nothing else: the words and the media type stay). */
export const CLEARED_SEARCH_FILTERS: Record<SearchFilterKey, undefined> = {
  camera: undefined,
  make: undefined,
  lens: undefined,
  iso_min: undefined,
  iso_max: undefined,
  aperture_min: undefined,
  aperture_max: undefined,
  focal_min: undefined,
  focal_max: undefined,
  focal35_min: undefined,
  focal35_max: undefined,
  rating_min: undefined,
  taken_after: undefined,
  taken_before: undefined,
  has_location: undefined,
  file_type: undefined,
  extension: undefined,
  person: undefined,
};

/** Every filter key, for the badge count. */
export const SEARCH_FILTER_KEYS = Object.keys(CLEARED_SEARCH_FILTERS).filter(
  (key): key is SearchFilterKey => key in CLEARED_SEARCH_FILTERS
);

// Each key on its own: a bad value drops that filter, not the page or the other filters.
const SearchFilterParams = z.object({
  camera: text.optional().catch(undefined),
  make: text.optional().catch(undefined),
  lens: text.optional().catch(undefined),
  iso_min: whole.optional().catch(undefined),
  iso_max: whole.optional().catch(undefined),
  aperture_min: decimal.optional().catch(undefined),
  aperture_max: decimal.optional().catch(undefined),
  focal_min: decimal.optional().catch(undefined),
  focal_max: decimal.optional().catch(undefined),
  focal35_min: whole.optional().catch(undefined),
  focal35_max: whole.optional().catch(undefined),
  rating_min: z.number().int().min(1).max(5).optional().catch(undefined),
  taken_after: day.optional().catch(undefined),
  taken_before: day.optional().catch(undefined),
  has_location: z.boolean().optional().catch(undefined),
  file_type: FileTypeFilter.optional().catch(undefined),
  extension: text
    .transform(value => value.toLowerCase().replace(/^\./, ""))
    .pipe(z.string().regex(/^[a-z0-9]{1,9}$/))
    .optional()
    .catch(undefined),
  person: people.optional().catch(undefined),
} satisfies Record<SearchFilterKey, z.ZodType>);

/**
 * The filters in `search` (a route's raw search params); unknown keys and bad values are dropped.
 * An unset filter may be present as undefined: the URL, the query key and JSON leave it out.
 */
export function validateSearchFilters(search: Record<string, unknown>): SearchFilters {
  return SearchFilterParams.parse(search);
}

/** The search routes' `validateSearch`: the media button's `?media` plus the filters. */
export function validateSearchPage(search: Record<string, unknown>): { media?: MediaType } & SearchFilters {
  return { ...validateMediaSearch(search), ...validateSearchFilters(search) };
}

/** The filters that read as one: a range or a day span is one filter, as its chip is. */
const SEARCH_FILTER_GROUPS: readonly (readonly SearchFilterKey[])[] = [
  ["make"],
  ["camera"],
  ["lens"],
  ["iso_min", "iso_max"],
  ["aperture_min", "aperture_max"],
  ["focal_min", "focal_max"],
  ["focal35_min", "focal35_max"],
  ["rating_min"],
  ["taken_after", "taken_before"],
  ["has_location"],
  ["file_type"],
  ["extension"],
];

/** How many filters are set, for the Filters button's badge: one per chip (each person is one). */
export function countSearchFilters(filters: SearchFilters): number {
  const groups = SEARCH_FILTER_GROUPS.filter(keys => keys.some(key => filters[key] !== undefined)).length;
  return groups + (filters.person?.length ?? 0);
}

export function hasSearchFilters(filters: SearchFilters): boolean {
  return countSearchFilters(filters) > 0;
}

/**
 * The select-all `query` of a filter-only search: the same filters and media type, and every photo
 * of a stack (search lists them all, the server's default select-all only each stack's top photo).
 * Undefined when the search has words: the server's select-all ignores them, so the page selects
 * the listed photos themselves (search loads all of them at once).
 */
export function searchSelectAllQuery(
  term: string,
  filters: SearchFilters,
  mediaType: MediaType
): BulkPhotoQuery | undefined {
  if (term.length > 0) return undefined;
  const { person, ...rest } = filters;
  return {
    ...rest,
    ...(person ? { person: [...person] } : {}),
    ...mediaTypeToBulkQuery(mediaType),
    show_all_stack_photos: true,
  };
}
