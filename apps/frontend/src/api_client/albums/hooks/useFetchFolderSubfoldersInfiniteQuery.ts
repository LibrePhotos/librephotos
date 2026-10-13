import { albumKeys, endpoints, type FolderSubfolder, type FolderSubfoldersResponse } from "@librephotos/api-client";
import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { apiClient } from "../../api";
import { retryFolderRequest } from "./useFetchFolderAlbumsQuery";

export const useFetchFolderSubfoldersInfiniteQuery = (
  path?: string,
  { refetchOnWindowFocus = true }: { refetchOnWindowFocus?: boolean } = {}
) =>
  useInfiniteQuery<FolderSubfoldersResponse>({
    queryKey: albumKeys.folderPages(path),
    queryFn: ({ pageParam }) => {
      const page = typeof pageParam === "number" && pageParam > 0 ? pageParam : 1;
      return endpoints.fetchFolderSubfolders(apiClient, { path, page });
    },
    getNextPageParam: lastPage => (lastPage.next === null ? undefined : lastPage.page + 1),
    initialPageParam: 1,
    retry: retryFolderRequest,
    retryDelay: 1000,
    refetchOnWindowFocus,
  });

/**
 * Every subfolder of `path`, for lists that show them all at once (the Folders
 * page, the albums overview). The endpoint pages by 100 directory entries, so a
 * library with more top-level folders than that lost the rest. Pages are loaded
 * one after the other rather than on scroll: one can come back empty (folders
 * without photos are dropped after paging) while more follow.
 */
export function useAllFolderSubfolders(path?: string): {
  subfolders: FolderSubfolder[];
  isLoading: boolean;
  isFetching: boolean;
  /** The query itself, for `useListFailure`. */
  query: UseInfiniteQueryResult<InfiniteData<FolderSubfoldersResponse>>;
} {
  // A refetch reloads every page, one heavy request each: not worth it on every
  // window focus just for a count and a few previews. Mounting the page still does.
  const query = useFetchFolderSubfoldersInfiniteQuery(path, { refetchOnWindowFocus: false });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching, isLoading, isError } = query;

  // Keyed on the page count too: a page that answers at once can arrive in the
  // same render as the end of the fetch before it, leaving the flags unchanged.
  const pageCount = data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage, pageCount]);

  const subfolders = useMemo(() => data?.pages.flatMap(page => page.results) ?? [], [data]);
  const morePagesComing = Boolean(hasNextPage && !isError);
  return {
    subfolders,
    // Still loading while only empty pages are in and more follow, or "no folders" flashed
    isLoading: isLoading || (subfolders.length === 0 && morePagesComing),
    isFetching: isFetching || morePagesComing,
    query,
  };
}
