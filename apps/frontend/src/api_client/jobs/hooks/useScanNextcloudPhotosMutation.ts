import { albumKeys, endpoints, jobKeys, serverKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { startJob } from "../startJob";

export const useScanNextcloudPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      // Already running: startJob says so and the page follows that job.
      const start = await startJob(() => endpoints.scanNextcloudPhotos(apiClient));
      if (start.alreadyRunning) {
        return;
      }
      notification.startNextcloudPhotoScan();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() });
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
      queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
      queryClient.invalidateQueries({ queryKey: serverKeys.stats() });
      queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
    },
  });
