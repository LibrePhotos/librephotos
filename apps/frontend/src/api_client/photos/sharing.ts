import _ from "lodash";
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto, PigPhotoSchema, SimpleUserSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";

const SharedPhotosByMeResponseSchema = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUserSchema,
      photo: PigPhotoSchema,
    })
    .array(),
});
const SharedPhotosWithMeResponseSchema = z.object({
  results: PigPhotoSchema.array(),
});

const SharePhotosRequestSchema = z.object({
  image_hashes: z.string().array(),
  val_shared: z.boolean(),
  target_user: SimpleUserSchema,
});
type SharePhotosRequest = z.infer<typeof SharePhotosRequestSchema>;

type UserPhotosGroup = {
  userId: number;
  photos: PigPhoto[];
};

// Fetch shared photos by me
export const useFetchSharedPhotosByMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsByMe],
  queryFn: async () => {
    const response = await fetchClient.get('photos/shared/fromme/');
    const { results } = SharedPhotosByMeResponseSchema.parse(response);
    return _.toPairs(_.groupBy(results, "user_id")).map(el => ({
      userId: parseInt(el[0], 10),
      photos: el[1].map(item => item.photo),
    }));
  },
});

// Fetch shared photos with me
export const useFetchSharedPhotosWithMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsWithMe],
  queryFn: async () => {
    const response = await fetchClient.get('photos/shared/tome/');
    const { results } = SharedPhotosWithMeResponseSchema.parse(response);
    return _.toPairs(_.groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
  },
});

// Update photo sharing
export const useUpdatePhotoSharingMutation = () => useMutation({
  mutationFn: async ({ image_hashes, val_shared, target_user }: SharePhotosRequest) => {
    await fetchClient.post('photosedit/share/', {
      image_hashes,
      val_shared,
      target_user_id: target_user.id,
    });
    notification.togglePhotoSharing(target_user.username, image_hashes.length, val_shared);
  },
  onSuccess: (_, { image_hashes }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsByMe] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsWithMe] });
    
    // If we have a single photo, invalidate its details
    if (image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, image_hashes[0]] });
    }
  },
}); 