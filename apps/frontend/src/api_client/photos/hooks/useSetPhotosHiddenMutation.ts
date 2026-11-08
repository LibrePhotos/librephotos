import { endpoints, faceKeys, photoKeys, statsKeys } from "@librephotos/api-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";
import { useBulkPhotoToggle } from "./useBulkPhotoToggle";

type SetPhotosHiddenRequest = PhotoSelection & { hidden: boolean };

async function setHidden(request: SetPhotosHiddenRequest) {
  const [imageHashes, selectAll] = selectionArgs(request);
  return endpoints.setPhotosHidden(apiClient, imageHashes, request.hidden, selectAll);
}

function refresh(queryClient: QueryClient, request: SetPhotosHiddenRequest) {
  // Invalidate relevant queries to ensure consistent state
  invalidatePhotoLists(queryClient);
  void queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() });
  void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
  void queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });

  // If we have a single photo in individual mode, invalidate its details
  const imageHash = singlePhotoHash(request);
  if (imageHash !== undefined) {
    void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
  }
}

/** Hide or unhide photos; the toast's Undo sets them back. */
export const useSetPhotosHiddenMutation = () => {
  const queryClient = useQueryClient();
  return useBulkPhotoToggle({
    send: setHidden,
    refresh: request => refresh(queryClient, request),
    invert: (request, image_hashes) => ({ image_hashes, hidden: !request.hidden }),
    notify: (count, request, undo) => notification.togglePhotosHidden(count, request.hidden, undo),
  });
};
