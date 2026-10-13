import { endpoints, jobKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Runs text recognition over the library. Without `fullScan` only photos that have no OCR
 * result yet are processed, so it is safe to re-run after adding photos.
 */
export const useGenerateOcrMutation = () =>
  useMutation({
    mutationFn: async (fullScan: boolean) => {
      const start = await startJob(() => endpoints.generateOcr(apiClient, fullScan));
      if (start.alreadyRunning) {
        return;
      }
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
