import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../../jobs/startJob";

/**
 * Empty trash (#2203): queues the job that deletes every photo in the user's trash, original files
 * included, and resolves with the job's id: the new one, or the one already running (a 409, which
 * `startJob` reports itself). `count` is the trash the user confirmed, for the toast.
 */
export const useEmptyTrashMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (count: number) => {
      const start = await startJob(() => endpoints.emptyTrash(apiClient));
      if (start.alreadyRunning) {
        return start.jobId;
      }
      notification.emptyTrashStarted(count);
      return start.data.job_id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
