import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { duplicateKeys } from "../../duplicates/keys";
import { serverKeys } from "../../server/keys";
import { statsKeys } from "../../stats/keys";
import { photoGridKeys } from "../keys";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

export const usePurgeDeletedPhotosMutation = () =>
  useMutation({
    mutationFn: async (request: PhotoSelection) => {
      const data = await endpoints.deletePhotos(apiClient, ...selectionArgs(request));

      // Show notification based on mode
      if (request.select_all) {
        notification.removePhotos(data.count ?? 0);
      } else {
        notification.removePhotos(data.deleted?.length ?? request.image_hashes.length);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
      queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
    },
  });
