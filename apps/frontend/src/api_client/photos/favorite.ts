import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { PhotoSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../api";

const FavoritePhotosRequestSchema = z.object({
  image_hashes: z.string().array(),
  favorite: z.boolean(),
});
type FavoritePhotosRequest = z.infer<typeof FavoritePhotosRequestSchema>;

const UpdatedPhotosResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
type UpdatedPhotosResponse = z.infer<typeof UpdatedPhotosResponseSchema>;

// Set favorite photos
export const useSetFavoritePhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes, favorite }: FavoritePhotosRequest) => {
    const response = await fetchClient.post('photosedit/favorite/', {
      image_hashes,
      favorite,
    });
    const data = UpdatedPhotosResponseSchema.parse(response);
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