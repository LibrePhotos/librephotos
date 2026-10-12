import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { statsKeys } from "../../stats/keys";
import { jobKeys } from "../keys";
import { startJob } from "../startJob";

const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
/**
 * Runs text recognition over the library. Without `fullScan` only photos that have no OCR
 * result yet are processed, so it is safe to re-run after adding photos.
 */
export const useGenerateOcrMutation = () =>
  useMutation({
    mutationFn: async (fullScan: boolean) => {
      const start = await startJob(() => apiClient.post("/generateocr/", { full_scan: fullScan }));
      if (start.alreadyRunning) {
        return;
      }
      parseWithNotification(JobResponse, start.data, "Failed to parse generate OCR response");
      if (fullScan) {
        notification.startFullOcrScan();
      } else {
        notification.startOcrScan();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
      queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    },
  });
