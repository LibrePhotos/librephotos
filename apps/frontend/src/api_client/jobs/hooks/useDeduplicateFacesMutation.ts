import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Deletes the duplicate faces of every user's photos, the job behind `manage.py deduplicate_faces`
 * (admins only, #2030). Its progress shows in the job list and the worker ring.
 */
export const useDeduplicateFacesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.deduplicateFaces(apiClient));
      if (!start.alreadyRunning) {
        notification.startDeduplicateFaces();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
