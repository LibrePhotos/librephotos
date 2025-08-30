import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchClient, queryClient } from '../../api';
import { RecentlyAddedPhotosQueryKeys } from '../../photos/hooks/useFetchRecentlyAddedPhotosQuery';
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';
import { StorageStatsQueryKeys } from '../../server/hooks/useFetchStorageStatsQuery';
import { UploadOptions } from '../types';

export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});

const upload = (options: UploadOptions) => {
    const headers = new Headers({
      'Content-Range': `bytes ${options.offset}-${options.offset + options.chunk_size - 1}/${options.chunk_size}`,
    });
    return fetchClient.request('/upload/', {
      method: 'POST',
      body: options.form_data,
      headers,
    }).then(response => UploadResponse.parse(response));
    }

export const useUploadMutation = () => useMutation({
        mutationFn: upload,
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
          queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
          queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
          queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
          queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
        }
    });  