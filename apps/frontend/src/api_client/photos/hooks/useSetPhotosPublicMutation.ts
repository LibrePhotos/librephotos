import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { BulkPhotoQuery, Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery'; 
import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';

const UpdatePhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array().optional(),
  updated: Photo.array().optional(),
  not_updated: Photo.array().optional(),
  count: z.number().optional(),
});
type UpdatePhotosResponse = z.infer<typeof UpdatePhotosResponse>;

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  val_public: boolean;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  val_public: boolean;
};

type SetPhotosPublicRequest = IndividualRequest | SelectAllRequest;

// Set photos public
export const useSetPhotosPublicMutation = () => useMutation({
  mutationFn: async (request: SetPhotosPublicRequest) => {
    const response = await fetchClient.post('/photosedit/makepublic/', request);
    const data = UpdatePhotosResponse.parse(response);
    
    // Show notification based on mode
    if (request.select_all) {
      notification.togglePhotosPublic(data.count ?? 0, request.val_public);
    } else {
      notification.togglePhotosPublic(request.image_hashes.length, request.val_public);
    }
    
    return data;
  },
  onSuccess: (data, request) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    
    // If we have a single photo in individual mode, invalidate its details
    if (!request.select_all && request.image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hashes[0]] });
    }
  },
});
