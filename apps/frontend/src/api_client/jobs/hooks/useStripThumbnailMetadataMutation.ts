import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/**
 * Removes the photo details (EXIF, GPS, XMP) that thumbnails from 1.2.1 or older still carry, over
 * the whole instance (admins only, #2321). Its progress shows in the job list and the worker ring.
 */
export const useStripThumbnailMetadataMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.stripThumbnailMetadata(apiClient));
      if (!start.alreadyRunning) {
        notification.startStripThumbnailMetadata();
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
  });
};
