import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { JobsQueryKeys } from "./useJobsQuery";
import { WorkerQueryKeys } from "./useWorkerQuery";

const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
type JobResponse = z.infer<typeof JobResponse>;

/**
 * Runs text recognition over the library. Without `fullScan` only photos that have no OCR
 * result yet are processed, so it is safe to re-run after adding photos.
 */
export const useGenerateOcrMutation = () =>
  useMutation({
    mutationFn: async (fullScan: boolean) => {
      const response = await fetchClient.post("/generateocr/", { full_scan: fullScan });
      const data = parseWithNotification(JobResponse, response, "Failed to parse generate OCR response");
      if (fullScan) {
        notification.startFullOcrScan();
      } else {
        notification.startOcrScan();
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...WorkerQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    },
  });
