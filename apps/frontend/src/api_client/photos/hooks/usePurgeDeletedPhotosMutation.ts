import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { BulkPhotoQuery } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";

import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';
import { StorageStatsQueryKeys } from '../../server/hooks/useFetchStorageStatsQuery';

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
};

type PurgePhotosRequest = IndividualRequest | SelectAllRequest;

const PurgePhotosResponse = z.object({
  status: z.boolean(),
  results: z.string().array().optional(),
  deleted: z.string().array().optional(),
  not_deleted: z.string().array().optional(),
  count: z.number().optional(),
});
type PurgePhotosResponse = z.infer<typeof PurgePhotosResponse>;

export const usePurgeDeletedPhotosMutation = () => useMutation({
  mutationFn: async (request: PurgePhotosRequest) => {
    const response = await fetchClient.delete('/photosedit/delete/', request);
    const data = PurgePhotosResponse.parse(response);
    
    // Show notification based on mode
    if (request.select_all) {
      notification.removePhotos(data.count ?? 0);
    } else {
      notification.removePhotos(data.deleted?.length ?? request.image_hashes.length);
    }
    
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
  },
}); 