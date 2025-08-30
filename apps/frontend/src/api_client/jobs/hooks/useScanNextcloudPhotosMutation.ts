import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';
import { JobsQueryKeys } from './useJobsQuery';
import { WorkerQueryKeys } from './useWorkerQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';
import { ServerStatsQueryKeys } from '../../server/hooks/useFetchServerStatsQuery';
import { StorageStatsQueryKeys } from '../../server/hooks/useFetchStorageStatsQuery';

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
    queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...WorkerQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...ServerStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
  },
}); 