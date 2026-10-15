import { endpoints, jobKeys } from "@librephotos/api-client";
import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";

export const useDeleteJobMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => endpoints.deleteJob(apiClient, id),
    onSuccess: (_data, id) => {
      // Everything but the removed job's own detail: refetching it would turn its page into a 404
      // before the page leaves (#2213). An unwatched copy is dropped; a watched one goes with its page.
      const removed = jobKeys.detail(id);
      queryClient.removeQueries({ queryKey: removed, exact: true, type: "inactive" });
      void queryClient.invalidateQueries({
        queryKey: jobKeys.all,
        predicate: query => query.queryHash !== hashKey(removed),
      });
      // A removed unfinished row (a stuck job) may have been what kept the queue busy.
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
    // onSettled, not onError: a hook's onError would silence the QueryClient's toast, which shows
    // the server's reason for any refused removal (mutationErrors.ts).
    onSettled: (_data, error) => {
      // The list predates the newest scan baseline, which the server keeps (#1104): a fresh list
      // disables Remove on it.
      if (error instanceof ApiError && error.serverCode === "scan_baseline") {
        void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      }
    },
  });
};
