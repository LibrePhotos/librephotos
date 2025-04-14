import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';

const DeleteDuplicatePhotoRequest = z.object({
  image_hash: z.string(),
  path: z.string(),
});
type DeleteDuplicatePhotoRequest = z.infer<typeof DeleteDuplicatePhotoRequest>;

export const useDeleteDuplicatePhotoMutation = () => useMutation({
  mutationFn: async ({ image_hash, path }: DeleteDuplicatePhotoRequest) => {
    await fetchClient.delete('/photosedit/duplicate/delete/', { image_hash, path });
    notification.removePhotos(1);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
  },
}); 