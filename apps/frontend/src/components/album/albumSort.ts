import type { ParseKeys } from "i18next";
import { z } from "zod";
import type { StorageKey } from "../../util/storage";

/**
 * Sorting the album lists (#620): My Albums, Events, Things, Places, People, Tags and Folders.
 * Each list is fetched whole, so it is sorted here, on a copy; the server keeps its own order,
 * which the mobile app reads.
 */

export const AlbumSortKey = z.enum(["name", "count", "date", "size"]);
export type AlbumSortKey = z.infer<typeof AlbumSortKey>;

export const SortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirection>;

/** What a page is sorted by, as it is stored per page. */
export const AlbumSort = z.object({ key: AlbumSortKey, direction: SortDirection });
export type AlbumSort = Readonly<z.infer<typeof AlbumSort>>;

/** A number, a text, or nothing: an item without a value goes last in either direction. */
type SortValue = string | number | null | undefined;

export type AlbumSortOption<T> = Readonly<{
  key: AlbumSortKey;
  /** The menu's name for it, when the key's own (SORT_KEY_LABELS) does not fit the page. */
  label?: ParseKeys;
  value: (item: T) => SortValue;
  /** False leaves the option out of the menu, e.g. a field an older server does not send. */
  isAvailable?: (items: readonly T[]) => boolean;
}>;

export type AlbumSortConfig<T> = Readonly<{
  storageKey: StorageKey;
  /** The page's order before the user picks one, and what "Reset to default" goes back to. */
  defaultSort: AlbumSort;
  /** In menu order. */
  options: readonly AlbumSortOption<T>[];
}>;

export const SORT_KEY_LABELS: Record<AlbumSortKey, ParseKeys> = {
  name: "albumsort.name",
  count: "albumsort.photos",
  date: "albumsort.datetaken",
  size: "albumsort.placesize",
};

/** Each key's directions in words; the first is the direction a key starts in when picked. */
export const DIRECTIONS: Record<AlbumSortKey, readonly [SortDirection, SortDirection]> = {
  name: ["asc", "desc"],
  count: ["desc", "asc"],
  date: ["desc", "asc"],
  // A lower geolocation level is a broader place: countries come first
  size: ["asc", "desc"],
};

export const DIRECTION_LABELS: Record<AlbumSortKey, Record<SortDirection, ParseKeys>> = {
  name: { asc: "albumsort.atoz", desc: "albumsort.ztoa" },
  count: { asc: "albumsort.fewestfirst", desc: "albumsort.mostfirst" },
  date: { asc: "albumsort.oldestfirst", desc: "albumsort.newestfirst" },
  size: { asc: "albumsort.largestfirst", desc: "albumsort.smallestfirst" },
};

/** After the chosen key, ties go by number (most first), then by name. */
const TIE_BREAKS: readonly AlbumSort[] = [
  { key: "count", direction: "desc" },
  { key: "name", direction: "asc" },
];

// "Album 2" before "Album 10", and case and accents do not split the alphabet
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isMissing(value: SortValue): value is null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

function compareValues(a: SortValue, b: SortValue): number {
  if (isMissing(a) || isMissing(b)) return Number(isMissing(a)) - Number(isMissing(b));
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

export function sameSort(a: AlbumSort, b: AlbumSort): boolean {
  return a.key === b.key && a.direction === b.direction;
}

/** The sort after picking `key` in the menu: the page default's direction for its key, else the key's first. */
export function sortForKey(key: AlbumSortKey, current: AlbumSort, defaultSort: AlbumSort): AlbumSort {
  if (key === current.key) return current;
  if (key === defaultSort.key) return defaultSort;
  return { key, direction: DIRECTIONS[key][0] };
}

/**
 * A sorted copy of `items`. Each value is read once per item; items without one go last, and
 * items that tie on every key keep the order they came in.
 */
export function sortAlbums<T>(items: readonly T[], options: readonly AlbumSortOption<T>[], sort: AlbumSort): T[] {
  const sorts = [sort, ...TIE_BREAKS.filter(tie => tie.key !== sort.key)];
  const comparisons = sorts.flatMap(({ key, direction }) => {
    const option = options.find(candidate => candidate.key === key);
    return option ? [{ value: option.value, sign: direction === "asc" ? 1 : -1 }] : [];
  });
  const rows = items.map(item => ({ item, values: comparisons.map(({ value }) => value(item)) }));
  rows.sort((a, b) => {
    for (const [index, { sign }] of comparisons.entries()) {
      const x = a.values[index];
      const y = b.values[index];
      const order = isMissing(x) || isMissing(y) ? compareValues(x, y) : sign * compareValues(x, y);
      if (order !== 0) return order;
    }
    return 0;
  });
  return rows.map(row => row.item);
}
