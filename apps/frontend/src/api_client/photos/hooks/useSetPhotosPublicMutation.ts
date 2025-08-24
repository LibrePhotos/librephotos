import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery'; 
import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';

const UpdatePhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array(),
  updated: Photo.array(),
  not_updated: Photo.array(),
});
type UpdatePhotosResponse = z.infer<typeof UpdatePhotosResponse>;

const SetPhotosPublicRequest = z.object({
  image_hashes: z.array(z.string()),
  val_public: z.boolean(),
});
type SetPhotosPublicRequest = z.infer<typeof SetPhotosPublicRequest>;

// Set photos public
export const useSetPhotosPublicMutation = () => useMutation({
  mutationFn: async ({ image_hashes, val_public }: SetPhotosPublicRequest) => {
    const response = await fetchClient.post('/photosedit/makepublic/', { image_hashes, val_public });
    const data = UpdatePhotosResponse.parse(response);
    notification.togglePhotosPublic(image_hashes.length, true);
    return data;
  },
  onSuccess: (data, { image_hashes }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    
    // If we have a single photo, invalidate its details
    if (image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, image_hashes[0]] });
    }
  },
});