import { endpoints, jobKeys } from "@librephotos/api-client";
import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

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
  });
};
