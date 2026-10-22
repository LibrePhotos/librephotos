import { endpoints, jobKeys, serverKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

type ScanUser = Readonly<{ userId: number; username: string }>;

/**
 * Scan another user's library from the Admin Area (admins only, #2037): the same scan as their own
 * Scan button, so the job is theirs. Its progress shows next to their folder and in Worker Logs.
 */
export const useScanUserPhotosMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, username }: ScanUser) => {
      const start = await startJob(() => endpoints.scanUserPhotos(apiClient, userId));
      if (!start.alreadyRunning) {
        notification.startUserPhotoScan(username);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
      void queryClient.invalidateQueries({ queryKey: serverKeys.stats() });
    },
  });
};
