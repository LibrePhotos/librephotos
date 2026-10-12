import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys, photoKeys } from "../keys";
import type { BulkPhotoQuery, SimpleUser } from "../types";

const SharePhotosResponse = z.object({
  status: z.boolean(),
  count: z.number(),
});

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  val_shared: boolean;
  target_user: SimpleUser;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  val_shared: boolean;
  target_user: SimpleUser;
};

type SharePhotosRequest = IndividualRequest | SelectAllRequest;

export const useUpdatePhotoSharingMutation = () =>
  useMutation({
    mutationFn: async (request: SharePhotosRequest) => {
      const payload = request.select_all
        ? {
            select_all: true,
            query: request.query,
            excluded_hashes: request.excluded_hashes,
            val_shared: request.val_shared,
            target_user_id: request.target_user.id,
          }
        : {
            image_hashes: request.image_hashes,
            val_shared: request.val_shared,
            target_user_id: request.target_user.id,
          };

      const response = await apiClient.post("/photosedit/share/", payload);
      const data = parseWithNotification(SharePhotosResponse, response, "Failed to parse photo sharing response");

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotoSharing(request.target_user.username, data.count, request.val_shared);
      } else {
        notification.togglePhotoSharing(request.target_user.username, request.image_hashes.length, request.val_shared);
      }

      return data;
    },
    onSuccess: (_, request) => {
      queryClient.invalidateQueries({ queryKey: photoGridKeys.sharedByMe() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.sharedWithMe() });

      // If we have a single photo in individual mode, invalidate its details
      const [imageHash, ...others] = request.select_all ? [] : request.image_hashes;
      if (imageHash !== undefined && others.length === 0) {
        queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
