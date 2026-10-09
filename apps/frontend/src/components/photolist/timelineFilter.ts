import type { TFunction } from "i18next";
import type { BulkPhotoQuery } from "../../api_client/photos/types";
import type { User } from "../../api_client/user/types";

// The main timeline's filter (issue #2130). The same four keys are saved as
// the user's default (User.default_timeline_filter) and resolved by the
// backend in api/timeline_filter.py.
export type TimelineMedia = "all" | "photos" | "videos";

export type TimelineFilter = {
  media: TimelineMedia;
  hide_screenshots: boolean;
  hide_documents: boolean;
  favorites: boolean;
};

export type SavedTimelineFilter = User["default_timeline_filter"];

export const SHOW_EVERYTHING: TimelineFilter = {
  media: "all",
  hide_screenshots: false,
  hide_documents: false,
  favorites: false,
};

const KEYS = ["media", "hide_screenshots", "hide_documents", "favorites"] as const;

// The timeline route's search params: each one overrides the saved default
// for its key; an absent key falls back to the default. "No params" is the
// saved default, so a bookmark of "/" follows the default when it changes.
export type TimelineFilterSearch = Partial<TimelineFilter>;

function isMedia(value: unknown): value is TimelineMedia {
  return value === "all" || value === "photos" || value === "videos";
}

// TanStack Router JSON-parses search values, so ?hide_screenshots=true arrives
// as a boolean; a hand-typed "true" string is accepted too.
function asBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

// Route `validateSearch` for "/": unknown keys and values are dropped.
export function validateTimelineSearch(search: Record<string, unknown>): TimelineFilterSearch {
  const result: TimelineFilterSearch = {};
  if (isMedia(search.media)) result.media = search.media;
  const hideScreenshots = asBoolean(search.hide_screenshots);
  if (hideScreenshots !== undefined) result.hide_screenshots = hideScreenshots;
  const hideDocuments = asBoolean(search.hide_documents);
  if (hideDocuments !== undefined) result.hide_documents = hideDocuments;
  const favorites = asBoolean(search.favorites);
  if (favorites !== undefined) result.favorites = favorites;
  return result;
}

// The saved default with its missing keys filled in.
export function savedTimelineFilter(saved: SavedTimelineFilter | undefined): TimelineFilter {
  return {
    media: isMedia(saved?.media) ? saved.media : "all",
    hide_screenshots: saved?.hide_screenshots === true,
    hide_documents: saved?.hide_documents === true,
    favorites: saved?.favorites === true,
  };
}

// The filter in effect: the saved default, overridden key by key by the URL.
export function resolveTimelineFilter(
  saved: SavedTimelineFilter | undefined,
  search: TimelineFilterSearch
): TimelineFilter {
  return { ...savedTimelineFilter(saved), ...validateTimelineSearch(search) };
}

// The URL search params that make `filter` the current view: only the keys
// that differ from the saved default, so a filter equal to it is a bare "/".
export function timelineSearchFor(
  filter: TimelineFilter,
  saved: SavedTimelineFilter | undefined
): TimelineFilterSearch {
  const base = savedTimelineFilter(saved);
  const search: TimelineFilterSearch = {};
  KEYS.forEach(key => {
    if (filter[key] !== base[key]) {
      (search as Record<string, unknown>)[key] = filter[key];
    }
  });
  return search;
}

export function sameTimelineFilter(a: TimelineFilter, b: TimelineFilter) {
  return KEYS.every(key => a[key] === b[key]);
}

// How many keys narrow the timeline, for the Filter button's badge.
export function countActiveFilters(filter: TimelineFilter) {
  return KEYS.filter(key => filter[key] !== SHOW_EVERYTHING[key]).length;
}

// The params the timeline sends to /albums/date/list/ and /albums/date/<id>/.
// The filter is resolved here, from the default this page shows, and sent in
// full (never as apply_default), so the server answers for exactly the filter
// in the query key and on screen. Neutral keys are left out.
export function timelineFilterToParams(filter: TimelineFilter | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!filter) return params;
  if (filter.media !== "all") params.media = filter.media;
  if (filter.hide_screenshots) params.hide_screenshots = "true";
  if (filter.hide_documents) params.hide_documents = "true";
  if (filter.favorites) params.favorite = "true";
  return params;
}

// The same filter as a select-all query: "select all, then delete" on the
// timeline must act on what it shows, never on screenshots it hides.
export function timelineFilterToBulkQuery(filter: TimelineFilter): BulkPhotoQuery {
  const query: BulkPhotoQuery = {};
  if (filter.media !== "all") query.media = filter.media;
  if (filter.hide_screenshots) query.hide_screenshots = true;
  if (filter.hide_documents) query.hide_documents = true;
  if (filter.favorites) query.favorite = true;
  return query;
}

// A stable query-key slot for the filter; "none" when nothing filters.
export function timelineFilterKey(filter: TimelineFilter | undefined): string {
  const params = timelineFilterToParams(filter);
  const keys = Object.keys(params).sort();
  return keys.length ? keys.map(key => `${key}=${params[key]}`).join("&") : "none";
}

// A short description, e.g. "photos, no screenshots", for the popover footer
// ("Your default: ...") and the header ("Filtered: ..."). The fragments are
// joined the way the language lists things, and left in the case their
// translation gives them. "everything" when nothing filters.
export function describeTimelineFilter(filter: TimelineFilter, t: TFunction, language = "en"): string {
  const parts: string[] = [];
  if (filter.media === "photos") parts.push(t("timelinefilter.summary.photos"));
  if (filter.media === "videos") parts.push(t("timelinefilter.summary.videos"));
  if (filter.favorites) parts.push(t("timelinefilter.summary.favorites"));
  if (filter.hide_screenshots) parts.push(t("timelinefilter.summary.noscreenshots"));
  if (filter.hide_documents) parts.push(t("timelinefilter.summary.nodocuments"));
  if (parts.length === 0) return t("timelinefilter.summary.everything");
  try {
    return new Intl.ListFormat(language, { style: "short", type: "unit" }).format(parts);
  } catch {
    // An unknown language tag
    return new Intl.ListFormat("en", { style: "short", type: "unit" }).format(parts);
  }
}

export type TimelineItem = {
  video: boolean;
  is_screenshot: boolean;
  is_document: boolean;
  rating: number;
};

// Whether `filter` lets `item` into the timeline, for the lightbox's
// "where does this appear" line. Mirrors TimelineFilter.q in the backend.
export function timelineFilterShows(filter: TimelineFilter, item: TimelineItem, favoriteMinRating: number) {
  if (filter.media === "photos" && item.video) return false;
  if (filter.media === "videos" && !item.video) return false;
  if (filter.hide_screenshots && item.is_screenshot) return false;
  if (filter.hide_documents && item.is_document) return false;
  if (filter.favorites && item.rating < favoriteMinRating) return false;
  return true;
}
