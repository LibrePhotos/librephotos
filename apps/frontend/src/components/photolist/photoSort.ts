import { SearchSort } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";

export const PHOTO_SORTS: readonly SearchSort[] = SearchSort.options.filter(sort => sort !== "relevance");

export const RANKED_PHOTO_SORTS: readonly SearchSort[] = SearchSort.options;

export const PHOTO_SORT_LABELS: Record<SearchSort, ParseKeys> = {
  relevance: "photosort.bestmatch",
  newest: "albumsort.newestfirst",
  oldest: "albumsort.oldestfirst",
  largest: "photosort.largestfirst",
  smallest: "photosort.smallestfirst",
};

export type SizeSort = Extract<SearchSort, "largest" | "smallest">;

export const isSizeSort = (sort: SearchSort): sort is SizeSort => sort === "largest" || sort === "smallest";
