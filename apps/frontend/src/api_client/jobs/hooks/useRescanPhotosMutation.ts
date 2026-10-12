import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { AutoAlbumsQueryKeys } from "../../albums/hooks/useFetchAutoAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { ServerStatsQueryKeys } from "../../server/hooks/useFetchServerStatsQuery";
import { StorageStatsQueryKeys } from "../../server/hooks/useFetchStorageStatsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";
import { startJob } from "../startJob";
import { JobsQueryKeys } from "./useJobsQuery";
import { WorkerQueryKeys } from "./useWorkerQuery";

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
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...WorkerQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...ServerStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
    },
  });
