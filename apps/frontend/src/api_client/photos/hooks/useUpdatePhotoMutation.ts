import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import type { Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';

const PhotoUpdateResponse = z.object({
  image_hash: z.string(),
  hidden: z.boolean(),
  rating: z.number(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  video: z.boolean(),
  exif_timestamp: z.string(),
  timestamp: z.string(),
});
type PhotoUpdateResponse = z.infer<typeof PhotoUpdateResponse>;

export const useUpdatePhotoMutation = () => useMutation({
  mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
    const response = await fetchClient.patch(`/photos/edit/${id}/`, data);
    const result = PhotoUpdateResponse.parse(response);
    notification.updatePhoto();
    return result;
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, data.image_hash] });
  },
}); 