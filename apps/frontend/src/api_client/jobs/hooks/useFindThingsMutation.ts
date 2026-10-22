import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Finds the things in the library's photos (#2765). Without `fullScan` only photos that have no
 * things yet; with it every photo again, after the list of things changed. The user's own tags
 * are never touched.
 */
export const useFindThingsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fullScan: boolean) => {
      const start = await startJob(() => endpoints.findThings(apiClient, fullScan));
      if (start.alreadyRunning) {
        return;
      }
      notification.startThingsJob(fullScan);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
