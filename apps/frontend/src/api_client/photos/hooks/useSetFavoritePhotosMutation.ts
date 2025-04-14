import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

const FavoritePhotosRequest = z.object({
  image_hashes: z.string().array(),
  favorite: z.boolean(),
});
type FavoritePhotosRequest = z.infer<typeof FavoritePhotosRequest>;

const UpdatedPhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array(),
  updated: Photo.array(),
  not_updated: Photo.array(),
});
type UpdatedPhotosResponse = z.infer<typeof UpdatedPhotosResponse>;

// Set favorite photos
export const useSetFavoritePhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes, favorite }: FavoritePhotosRequest) => {
    const response = await fetchClient.post('/photosedit/favorite/', {
      image_hashes,
      favorite,
    });
    const data = UpdatedPhotosResponse.parse(response);
    notification.togglePhotosFavorite(image_hashes.length, favorite);
    return data;
  },
  onSuccess: (data, { image_hashes }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
    
    // If we have a single photo, invalidate its details
    if (image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, image_hashes[0]] });
    }
  },
}); 