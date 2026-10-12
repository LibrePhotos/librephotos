import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { faceKeys } from "../../faces/keys";
import { statsKeys } from "../../stats/keys";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { photoKeys } from "../keys";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";

type SetPhotosHiddenRequest = PhotoSelection & { hidden: boolean };

// Set photos hidden
export const useSetPhotosHiddenMutation = () =>
  useMutation({
    mutationFn: async (request: SetPhotosHiddenRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      const data = await endpoints.setPhotosHidden(apiClient, imageHashes, request.hidden, selectAll);

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotosHidden(data.count ?? 0, request.hidden);
      } else {
        notification.togglePhotosHidden(request.image_hashes.length, request.hidden);
      }

      return data;
    },
    onSuccess: (data, request) => {
      // Invalidate relevant queries to ensure consistent state
      invalidatePhotoLists(queryClient);
      queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });

      // If we have a single photo in individual mode, invalidate its details
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
