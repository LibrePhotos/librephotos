import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { fetchClient } from "../../api";
import { retryFolderRequest, type FolderNavigationResponse, type SubfolderInfo } from "./useFetchFolderAlbumsQuery";

const FOLDER_SUBFOLDERS_QUERY_KEY = ["folderSubfolders"] as const;

export const useFetchFolderSubfoldersInfiniteQuery = (
  path?: string,
  { refetchOnWindowFocus = true }: { refetchOnWindowFocus?: boolean } = {}
) =>
  useInfiniteQuery<FolderNavigationResponse>({
    queryKey: [...FOLDER_SUBFOLDERS_QUERY_KEY, "infinite", path],
    queryFn: async ({ pageParam }): Promise<FolderNavigationResponse> => {
      const page = typeof pageParam === "number" && pageParam > 0 ? pageParam : 1;
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      params.set("page", String(page));
      const response = await fetchClient.get(`/folders/subfolders/?${params.toString()}`);
      return response as FolderNavigationResponse;
    },
    getNextPageParam: lastPage => {
      const { pagination } = lastPage;
      if (pagination && pagination.has_next) {
        return (pagination.page || 1) + 1;
      }
      return undefined;
    },
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
  subfolders: SubfolderInfo[];
  isLoading: boolean;
  isFetching: boolean;
} {
  // A refetch reloads every page, one heavy request each: not worth it on every
  // window focus just for a count and a few previews. Mounting the page still does.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching, isLoading, isError } =
    useFetchFolderSubfoldersInfiniteQuery(path, { refetchOnWindowFocus: false });

  // Keyed on the page count too: a page that answers at once can arrive in the
  // same render as the end of the fetch before it, leaving the flags unchanged.
  const pageCount = data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage, pageCount]);

  const subfolders = useMemo(() => data?.pages.flatMap(page => page.subfolders) ?? [], [data]);
  const morePagesComing = Boolean(hasNextPage && !isError);
  return {
    subfolders,
    // Still loading while only empty pages are in and more follow, or "no folders" flashed
    isLoading: isLoading || (subfolders.length === 0 && morePagesComing),
    isFetching: isFetching || morePagesComing,
  };
}
