import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Generates captions over the library (#2211). Without `fullScan` only photos that have no
 * generated caption yet are captioned, so it is safe to re-run after adding photos. Captions the
 * user wrote are never replaced.
 */
export const useGenerateCaptionsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fullScan: boolean) => {
      const start = await startJob(() => endpoints.generateCaptions(apiClient, fullScan));
      if (start.alreadyRunning || "already_running" in start.data) {
        return;
      }
      notification.startCaptionsJob(fullScan, start.data.downloads_model);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
