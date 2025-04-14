import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

const UpdatePhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array(),
  updated: Photo.array(),
  not_updated: Photo.array(),
});

const SetPhotosHiddenRequest = z.object({
  image_hashes: z.array(z.string()),
  hidden: z.boolean(),
});
type SetPhotosHiddenRequest = z.infer<typeof SetPhotosHiddenRequest>;

// Set photos hidden
export const useSetPhotosHiddenMutation = () => useMutation({
  mutationFn: async ({ image_hashes, hidden }: SetPhotosHiddenRequest) => {
    const response = await fetchClient.post('/photosedit/hide/', { image_hashes, hidden });
    const data = UpdatePhotosResponse.parse(response);
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