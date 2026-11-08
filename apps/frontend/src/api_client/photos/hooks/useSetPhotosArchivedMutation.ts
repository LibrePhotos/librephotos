import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";
import { useBulkPhotoToggle } from "./useBulkPhotoToggle";

type SetPhotosArchivedRequest = PhotoSelection & { archived: boolean };

async function setArchived(request: SetPhotosArchivedRequest) {
  const [imageHashes, selectAll] = selectionArgs(request);
  return endpoints.setPhotosArchived(apiClient, imageHashes, request.archived, selectAll);
}

/**
 * Archive or unarchive photos (#545); the toast's Undo sets them back. Archived photos leave the
 * timeline and Memories but stay in albums, people, places, folders and search, so only the photo
 * grids (and the photo's details) go stale: no count or face list changes, unlike hiding.
 */
export const useSetPhotosArchivedMutation = () => {
  const queryClient = useQueryClient();
  return useBulkPhotoToggle({
    send: setArchived,
    refresh: request => {
      invalidatePhotoLists(queryClient);
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
    invert: (request, image_hashes) => ({ image_hashes, archived: !request.archived }),
    notify: (count, request, undo) => notification.togglePhotosArchived(count, request.archived, undo),
  });
};
