import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { albumKeys } from "../../albums/keys";
import { fetchClient, queryClient } from "../../api";
import { serverKeys } from "../../server/keys";
import { statsKeys } from "../../stats/keys";
import { jobKeys } from "../keys";
import { startJob } from "../startJob";

const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
export const useRescanPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      // Already running: startJob says so and the page follows that job.
      const start = await startJob(() => fetchClient.post("/fullscanphotos/", {}));
      if (start.alreadyRunning) {
        return;
      }
      parseWithNotification(JobResponse, start.data, "Failed to parse rescan photos response");
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
