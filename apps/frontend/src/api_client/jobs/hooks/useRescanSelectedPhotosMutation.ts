import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { apiClient, ApiError } from "../../api";
import { startJob } from "../startJob";

/**
 * Read the files of some of the user's photos again (#2214), also when they did not change:
 * thumbnails, metadata, date and hashes. `mutate(photoIds)`, at most 1,000 `Photo.id`s. Shows its
 * own toasts: started, the scan already running, or why it did not start (none of the photos has
 * a file in the library any more).
 */
export function useRescanSelectedPhotosMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoIds: readonly string[]) => startJob(() => endpoints.rescanPhotos(apiClient, photoIds)),
    onSuccess: start => {
      if (!start.alreadyRunning && !("already_running" in start.data)) {
        notification.rescanPhotosStarted(start.data.photo_count);
      }
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
    onError: error => {
      // The client already reports a 401 and a 500.
      if (error instanceof ApiError && (error.status === 401 || error.status === 500)) return;
      notification.rescanPhotosFailed(
        (error instanceof ApiError && error.serverMessage) || i18n.t("toasts.rescanphotosfailed")
      );
    },
  });
}
