import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

const PurgePhotosRequest = z.object({
  image_hashes: z.array(z.string()),
});
type PurgePhotosRequest = z.infer<typeof PurgePhotosRequest>;

const PurgePhotosResponse = z.object({
  status: z.boolean(),
  results: z.string().array(),
  deleted: z.string().array(),
  not_deleted: z.string().array(),
});
type PurgePhotosResponse = z.infer<typeof PurgePhotosResponse>;

export const usePurgeDeletedPhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes }: PurgePhotosRequest) => {
    const response = await fetchClient.delete('/photosedit/delete/', { image_hashes });
    const data = PurgePhotosResponse.parse(response);
    notification.removePhotos(data.deleted.length);
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
}); 