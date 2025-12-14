import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { BulkPhotoQuery, Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery';
import { IncompleteFacesQueryKeys } from '../../faces/hooks/useFetchIncompleteFacesQuery';
import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';

const UpdatePhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array().optional(),
  updated: Photo.array().optional(),
  not_updated: Photo.array().optional(),
  count: z.number().optional(),
});

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  hidden: boolean;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  hidden: boolean;
};

type SetPhotosHiddenRequest = IndividualRequest | SelectAllRequest;

// Set photos hidden
export const useSetPhotosHiddenMutation = () => useMutation({
  mutationFn: async (request: SetPhotosHiddenRequest) => {
    const response = await fetchClient.post('/photosedit/hide/', request);
    const data = UpdatePhotosResponse.parse(response);
    
    // Show notification based on mode
    if (request.select_all) {
      notification.togglePhotosHidden(data.count ?? 0, request.hidden);
    } else {
      notification.togglePhotosHidden(request.image_hashes.length, request.hidden);
    }
    
    return data;
  },
  onSuccess: (data, request) => {
    // Invalidate relevant queries to ensure consistent state
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...IncompleteFacesQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    
    // If we have a single photo in individual mode, invalidate its details
    if (!request.select_all && request.image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hashes[0]] });
    }
  },
});
