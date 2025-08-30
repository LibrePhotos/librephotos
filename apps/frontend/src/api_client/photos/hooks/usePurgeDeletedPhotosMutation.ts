import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";

import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';
import { StorageStatsQueryKeys } from '../../server/hooks/useFetchStorageStatsQuery';

const PurgePhotosRequest = z.object({
  image_hashes: z.array(z.string()),
});
type PurgePhotosRequest = z.infer<typeof PurgePhotosRequest>;

const PurgePhotosResponse = z.object({
  status: z.boolean(),
  results: z.string().array(),
  deleted: z.string().array(),
  not_deleted: z.string().array(),
});
type PurgePhotosResponse = z.infer<typeof PurgePhotosResponse>;

export const usePurgeDeletedPhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes }: PurgePhotosRequest) => {
    const response = await fetchClient.delete('/photosedit/delete/', { image_hashes });
    const data = PurgePhotosResponse.parse(response);
    notification.removePhotos(data.deleted.length);
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
  },
}); 