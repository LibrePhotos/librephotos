import { endpoints, jobKeys, photoGridKeys, statsKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

type Owner = Readonly<{ userId: number; username: string; count: number }>;

/**
 * Admin: move a user's photos outside their new library to their trash, as a job (#2036). Started
 * right after the user edit dialog saved the new scan directory. Files are not touched.
 */
export const useTrashPhotosOutsideLibraryMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, username, count }: Owner) => {
      const start = await startJob(() => endpoints.trashPhotosOutsideLibrary(apiClient, userId));
      if (!start.alreadyRunning) {
        notification.startTrashPhotosOutsideLibrary(username, count);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.all });
      void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    },
  });
};
