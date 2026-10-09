import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchClient } from "../../api";

const FOLDER_SUBFOLDERS_QUERY_KEY = ["folderSubfolders"] as const;

export interface SubfolderInfo {
  name: string;
  path: string;
  photo_count: number;
  modified: number;
}

export interface FolderNavigationResponse {
  // null, with an empty listing, for a user without a scan directory
  current_path: string | null;
  parent_path: string | null;
  subfolders: SubfolderInfo[];
  pagination?: {
    page: number;
    page_size: number;
    total_folders: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
}

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
    queryKey: [...FOLDER_SUBFOLDERS_QUERY_KEY, path],
    queryFn: async (): Promise<FolderNavigationResponse> => {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      return fetchClient.get<FolderNavigationResponse>(`/folders/subfolders/${params}`);
    },
    retry: retryFolderRequest,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });
