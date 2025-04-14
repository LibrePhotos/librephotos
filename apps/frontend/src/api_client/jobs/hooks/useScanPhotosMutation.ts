import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
type JobResponse = z.infer<typeof JobResponse>;

export const useScanPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('/scanphotos/', {});
    const data = JobResponse.parse(response);
    notification.startPhotoScan();
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
}); 