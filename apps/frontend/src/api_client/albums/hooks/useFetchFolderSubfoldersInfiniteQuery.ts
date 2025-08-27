import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchClient } from '../../api';
import type { FolderNavigationResponse } from './useFetchFolderAlbumsQuery';

const FOLDER_SUBFOLDERS_QUERY_KEY = ['folderSubfolders'] as const;

export const useFetchFolderSubfoldersInfiniteQuery = (path?: string) =>
  useInfiniteQuery<FolderNavigationResponse>({
    queryKey: [...FOLDER_SUBFOLDERS_QUERY_KEY, 'infinite', path],
    queryFn: async ({ pageParam }): Promise<FolderNavigationResponse> => {
      const page = typeof pageParam === 'number' && pageParam > 0 ? pageParam : 1;
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      params.set('page', String(page));
      const response = await fetchClient.get(`/folders/subfolders/?${params.toString()}`);
      return response as FolderNavigationResponse;
    },
    getNextPageParam: (lastPage) => {
      const pagination = lastPage.pagination;
      if (pagination && pagination.has_next) {
        return (pagination.page || 1) + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    retry: 3,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
  });


