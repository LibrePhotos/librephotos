import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { photoGridKeys, photoKeys } from "../keys";
import type { BulkPhotoQuery } from "../types";

const UpdatePhotosResponse = z.object({
  status: z.boolean(),
  // Hashes, not serialized photos: the backend no longer builds a payload per photo.
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});
type UpdatePhotosResponse = z.infer<typeof UpdatePhotosResponse>;

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  val_public: boolean;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  val_public: boolean;
};

type SetPhotosPublicRequest = IndividualRequest | SelectAllRequest;

// Set photos public
export const useSetPhotosPublicMutation = () =>
  useMutation({
    mutationFn: async (request: SetPhotosPublicRequest) => {
      const response = await fetchClient.post("/photosedit/makepublic/", request);
      const data = parseWithNotification(UpdatePhotosResponse, response, "Failed to parse set photos public response");

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotosPublic(data.count ?? 0, request.val_public);
      } else {
        notification.togglePhotosPublic(request.image_hashes.length, request.val_public);
      }

      return data;
    },
    onSuccess: (data, request) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });

      // If we have a single photo in individual mode, invalidate its details
      const [imageHash, ...others] = request.select_all ? [] : request.image_hashes;
      if (imageHash !== undefined && others.length === 0) {
        queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
