import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { PhotoSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";

const UpdatePhotosResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
type UpdatePhotosResponse = z.infer<typeof UpdatePhotosResponseSchema>;

const SetPhotosPublicRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  val_public: z.boolean(),
});
type SetPhotosPublicRequest = z.infer<typeof SetPhotosPublicRequestSchema>;

const SetPhotosHiddenRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  hidden: z.boolean(),
});
type SetPhotosHiddenRequest = z.infer<typeof SetPhotosHiddenRequestSchema>;

// Set photos public
export const useSetPhotosPublicMutation = () => useMutation({
  mutationFn: async ({ image_hashes, val_public }: SetPhotosPublicRequest) => {
    const response = await fetchClient.post('photosedit/makepublic/', { image_hashes, val_public });
    const data = UpdatePhotosResponseSchema.parse(response);
    notification.togglePhotosPublic(image_hashes.length, true);
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

// Set photos hidden
export const useSetPhotosHiddenMutation = () => useMutation({
  mutationFn: async ({ image_hashes, hidden }: SetPhotosHiddenRequest) => {
    const response = await fetchClient.post('photosedit/hide/', { image_hashes, hidden });
    const data = UpdatePhotosResponseSchema.parse(response);
    notification.togglePhotosHidden(image_hashes.length, false);
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