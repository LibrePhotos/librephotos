import { endpoints, jobKeys, type CheckFileContentsScope } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";
import { startJob } from "../startJob";

/**
 * Reads every indexed file of every user, or of one user's library or folder, again and re-indexes
 * the ones replaced with their old date kept (admins only, #2040). Its progress shows in the job list
 * and the worker ring.
 */
export const useCheckFileContentsMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scope: CheckFileContentsScope) => {
      const start = await startJob(() => endpoints.checkFileContents(apiClient, scope));
      if (!start.alreadyRunning) {
        notification.startCheckFileContents();
      }
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: jobKeys.worker() }),
      ]),
    meta: mutationErrorMeta(options),
  });
};
