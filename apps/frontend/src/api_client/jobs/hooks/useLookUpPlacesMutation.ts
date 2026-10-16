import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Looks the place names of every photo up again with the current Map Provider, over the whole
 * instance (admins only, #2302). Its progress shows in the job list and the worker ring.
 */
export const useLookUpPlacesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.lookUpPlaces(apiClient));
      if (!start.alreadyRunning) {
        notification.startLookUpPlaces();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
