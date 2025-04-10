import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";

const JobResponseSchema = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
type JobResponse = z.infer<typeof JobResponseSchema>;

// Scan photos
export const useScanPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('scanphotos/', {});
    const data = JobResponseSchema.parse(response);
    notification.startPhotoScan();
    return data;
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
});

// Rescan photos
export const useRescanPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('fullscanphotos/', {});
    const data = JobResponseSchema.parse(response);
    notification.startFullPhotoScan();
    return data;
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
});

// Scan Nextcloud photos
export const useScanNextcloudPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('nextcloud/scanphotos/', {});
    const data = JobResponseSchema.parse(response);
    notification.startNextcloudPhotoScan();
    return data;
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
}); 