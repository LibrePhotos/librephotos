import type { PigPhoto } from "@librephotos/api-client";
import { useQueries, type QueryKey, type UseQueryResult } from "@tanstack/react-query";

type PhotoPage = { count: number; results: PigPhoto[] };

/** What a paged photo list knows of each page it asked for, in the order of `pages`. */
export type PhotoPages = {
  answers: ({ data: PhotoPage; at: number } | undefined)[];
  failed: boolean[];
  fetching: boolean[];
  refetch: (() => Promise<unknown>)[];
};

// Module-level, so useQueries combines again only when a page's query changed. Its result is
// structurally shared, so `answers` keeps its identity while only a fetching flag changes.
const combinePages = (results: UseQueryResult<PhotoPage>[]): PhotoPages => ({
  answers: results.map(result => (result.data ? { data: result.data, at: result.dataUpdatedAt } : undefined)),
  failed: results.map(result => result.isError),
  fetching: results.map(result => result.isFetching),
  refetch: results.map(result => result.refetch),
});

/** One query per page of a paged photo list, every page the list has asked for so far. */
export function usePhotoPages(
  pages: readonly number[],
  pageQuery: (page: number) => { queryKey: QueryKey; queryFn: () => Promise<PhotoPage> }
): PhotoPages {
  return useQueries({ queries: pages.map(pageQuery), combine: combinePages });
}
