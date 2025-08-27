import { useQuery } from '@tanstack/react-query';

import { fetchClient } from '../../api';

const FOLDER_SUBFOLDERS_QUERY_KEY = ['folderSubfolders'] as const;

export interface SubfolderInfo {
  name: string;
  path: string;
  photo_count: number;
  modified: number;
}

export interface FolderNavigationResponse {
  current_path: string;
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

export const useFetchFolderSubfoldersQuery = (path?: string) =>
  useQuery({
    queryKey: [...FOLDER_SUBFOLDERS_QUERY_KEY, path],
    queryFn: async (): Promise<FolderNavigationResponse> => {
      console.log('Fetching folder subfolders for path:', path);
      try {
        const params = path ? `?path=${encodeURIComponent(path)}` : '';
        const response = await fetchClient.get(`/folders/subfolders/${params}`);
        return response as FolderNavigationResponse;
      } catch (error) {
        console.error('Error fetching folder subfolders:', error);
        throw error;
      }
    },
    retry: 3,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });
