import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { albumKeys } from "../../albums/keys";
import { apiClient, queryClient } from "../../api";
import { serverKeys } from "../../server/keys";
import { statsKeys } from "../../stats/keys";
import { jobKeys } from "../keys";
import { startJob } from "../startJob";

export const useRescanPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      // Already running: startJob says so and the page follows that job.
      const start = await startJob(() => endpoints.fullScanPhotos(apiClient));
      if (start.alreadyRunning) {
        return;
      }
      notification.startFullPhotoScan();
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
