import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { BulkPhotoQuery, SimpleUser } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { SharedPhotosByMeQueryKeys } from './useFetchSharedPhotosByMeQuery';
import { SharedPhotosWithMeQueryKeys } from './useFetchSharedPhotosWithMeQuery';
import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';

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

export const useUpdatePhotoSharingMutation = () => useMutation({
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

    const response = await fetchClient.post('/photosedit/share/', payload);
    const data = SharePhotosResponse.parse(response);
    
    // Show notification based on mode
    if (request.select_all) {
      notification.togglePhotoSharing(request.target_user.username, data.count, request.val_shared);
    } else {
      notification.togglePhotoSharing(request.target_user.username, request.image_hashes.length, request.val_shared);
    }
    
    return data;
  },
  onSuccess: (_, request) => {
    queryClient.invalidateQueries({ queryKey: [...SharedPhotosByMeQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...SharedPhotosWithMeQueryKeys] });
    
    // If we have a single photo in individual mode, invalidate its details
    if (!request.select_all && request.image_hashes.length === 1) {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hashes[0]] });
    }
  },
});
