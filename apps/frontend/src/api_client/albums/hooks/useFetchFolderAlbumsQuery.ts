import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";
import { albumKeys } from "../keys";

export type SubfolderInfo = {
  name: string;
  path: string;
  photo_count: number;
  modified: number;
};

/**
 * One page of a folder's subfolders: the shared page envelope (backend
 * `api/pagination.py`) plus the folder's own paths. The server still repeats
 * the page as `subfolders` and `pagination` for older web bundles; read
 * `results` and `next`.
 */
export type FolderNavigationResponse = {
  // null, with an empty listing, for a user without a scan directory
  current_path: string | null;
  parent_path: string | null;
  results: SubfolderInfo[];
  count: number;
  next: string | null;
  previous: string | null;
  page: number;
  page_size: number;
  num_pages: number;
};

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
    queryFn: async (): Promise<FolderNavigationResponse> => {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      return apiClient.get<FolderNavigationResponse>(`/folders/subfolders/${params}`);
    },
    retry: retryFolderRequest,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });
