import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { Photo } from "../types";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';

const DeletePhotosRequest = z.object({
  image_hashes: z.array(z.string()),
  deleted: z.boolean(),
});
type DeletePhotosRequest = z.infer<typeof DeletePhotosRequest>;

const DeletePhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array(),
  updated: Photo.array(),
  not_updated: Photo.array(),
});
type DeletePhotosResponse = z.infer<typeof DeletePhotosResponse>;

export const useMarkPhotosDeletedMutation = () => useMutation({
  mutationFn: async ({ image_hashes, deleted }: DeletePhotosRequest) => {
    const response = await fetchClient.post('/photosedit/setdeleted/', { image_hashes, deleted });
    const data = DeletePhotosResponse.parse(response);
    notification.togglePhotoDelete(deleted, data.updated.length);
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
  },
}); 