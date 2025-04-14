import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';

const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
type JobResponse = z.infer<typeof JobResponse>;

export const useScanNextcloudPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('/nextcloud/scanphotos/', {});
    const data = JobResponse.parse(response);
    notification.startNextcloudPhotoScan();
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
  },
}); 