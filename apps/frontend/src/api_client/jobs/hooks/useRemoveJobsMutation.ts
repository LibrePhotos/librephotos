import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";

/**
 * Removes the jobs one after another and answers how many it removed. A job that is already gone
 * (404) or became the scan baseline since the list was read (409 scan_baseline) is skipped; any
 * other failure stops the run, and the lists refresh either way so they show what was removed.
 */
export const useRemoveJobsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly number[]) => {
      let removed = 0;
      for (const id of ids) {
        try {
          // One at a time: the server deletes a job per request, and a failure should stop the run.
          await endpoints.deleteJob(apiClient, id);
          removed += 1;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.serverCode === "scan_baseline")) continue;
          throw error;
        }
      }
      return removed;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      // A removed unfinished row may have kept the queue busy (see useDeleteJobMutation).
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
