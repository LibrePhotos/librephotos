import { endpoints, photoKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

type DeletePhotosRequest = PhotoSelection & { deleted: boolean };

export const useMarkPhotosDeletedMutation = () =>
  useMutation({
    mutationFn: async (request: DeletePhotosRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      const data = await endpoints.setPhotosDeleted(apiClient, imageHashes, request.deleted, selectAll);

      // Show notification based on mode; a no-op (e.g. already in the trash)
      // gets no "0 photos were moved to trash" toast.
      const count = request.select_all ? (data.count ?? 0) : (data.count ?? request.image_hashes.length);
      if (count > 0) {
        notification.togglePhotoDelete(request.deleted, count);
      }

      return data;
    },
    onSuccess: () => {
      invalidatePhotoLists(queryClient);
      // Cached details hold in_trashcan, which drives the lightbox's Delete/Restore toggle.
      queryClient.invalidateQueries({ queryKey: photoKeys.details() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
    },
  });
