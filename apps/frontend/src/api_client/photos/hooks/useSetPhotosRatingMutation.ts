import { endpoints, photoKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { singlePhotoHash } from "../photoSelection";

/**
 * Photos to rate, by hash: the server refuses a select-all rating. `rating` is
 * 0 (no rating) to 5.
 */
export type SetPhotosRatingRequest = { image_hashes: string[]; rating: number };

// Set a 0-5 star rating (stars mode, #2202). Unlike the favorite toggle it
// never zeroes a rating the user did not ask to clear.
export const useSetPhotosRatingMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ image_hashes: imageHashes, rating }: SetPhotosRatingRequest) => {
      const data = await endpoints.setPhotosRating(apiClient, imageHashes, rating);
      notification.setPhotosRating(imageHashes.length, rating);
      return data;
    },
    onSuccess: (_data, request) => {
      // Every grid draws its rating badge from the list data.
      invalidatePhotoLists(queryClient);
      // The lightbox's star row shows the pending rating until its photo's
      // details have the new one, so a single photo waits for them.
      const imageHash = singlePhotoHash(request);
      if (imageHash === undefined) return undefined;
      return queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
    },
  });
};
