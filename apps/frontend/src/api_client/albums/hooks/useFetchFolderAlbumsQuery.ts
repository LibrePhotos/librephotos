import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";

/**
 * A 4xx answer (a folder outside the scan directory gets 403) does not change
 * on a retry; only server and network failures are worth asking again.
 */
export function retryFolderRequest(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 3;
}

/**
 * Every subfolder of `path`, with its parent path (the folder page's strip and back button). The
 * endpoint pages by 100 directory entries; reading only the first page lost the rest.
 */
export const useFetchFolderSubfoldersQuery = (path?: string) =>
  useQuery({
    queryKey: albumKeys.folder(path),
    queryFn: () => endpoints.fetchAllFolderSubfolders(apiClient, { path }),
    retry: retryFolderRequest,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });
