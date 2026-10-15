import { endpoints, photoKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";

type SetPhotosArchivedRequest = PhotoSelection & { archived: boolean };

/**
 * Archive or unarchive photos (#545). Archived photos leave the timeline and Memories but stay in
 * albums, people, places, folders and search, so only the photo grids (and the photo's details) go
 * stale: no count or face list changes, unlike hiding.
 */
export const useSetPhotosArchivedMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SetPhotosArchivedRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      return endpoints.setPhotosArchived(apiClient, imageHashes, request.archived, selectAll);
    },
    onSuccess: (data, request) => {
      const count = data.count ?? (request.select_all ? 0 : request.image_hashes.length);
      notification.togglePhotosArchived(count, request.archived);
      invalidatePhotoLists(queryClient);
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
};
