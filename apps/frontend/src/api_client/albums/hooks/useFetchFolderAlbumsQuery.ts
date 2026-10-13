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

export const useFetchFolderSubfoldersQuery = (path?: string) =>
  useQuery({
    queryKey: albumKeys.folder(path),
    queryFn: () => endpoints.fetchFolderSubfolders(apiClient, { path }),
    retry: retryFolderRequest,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });
