import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { SimpleUser } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

const SharePhotosRequest = z.object({
  image_hashes: z.string().array(),
  val_shared: z.boolean(),
  target_user: SimpleUser,
});
type SharePhotosRequest = z.infer<typeof SharePhotosRequest>;

export const useUpdatePhotoSharingMutation = () => useMutation({
  mutationFn: async ({ image_hashes, val_shared, target_user }: SharePhotosRequest) => {
    await fetchClient.post('/photosedit/share/', {
      image_hashes,
      val_shared,
      target_user_id: target_user.id,
    });
    notification.togglePhotoSharing(target_user.username, image_hashes.length, val_shared);
  },
  onSuccess: (_, { image_hashes }) => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsByMe] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsWithMe] });
    
    if (image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, image_hashes[0]] });
    }
  },
}); 