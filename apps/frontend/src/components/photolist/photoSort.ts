import { SearchSort } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";

export const PHOTO_SORTS: readonly SearchSort[] = SearchSort.options;

export const PHOTO_SORT_LABELS: Record<SearchSort, ParseKeys> = {
  newest: "albumsort.newestfirst",
  oldest: "albumsort.oldestfirst",
  largest: "photosort.largestfirst",
  smallest: "photosort.smallestfirst",
};

export const isSizeSort = (sort: SearchSort): boolean => sort === "largest" || sort === "smallest";
