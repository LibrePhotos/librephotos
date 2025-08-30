import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { DateAlbumQueryKeys } from '../../albums/hooks/useFetchDateAlbumQuery';
import { RecentlyAddedPhotosQueryKeys } from './useFetchRecentlyAddedPhotosQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';

const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});
type DeleteMissingPhotosResponse = z.infer<typeof DeleteMissingPhotosResponse>;

export const useDeleteMissingPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('/deletemissingphotos', {});
    return DeleteMissingPhotosResponse.parse(response);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
  },
}); 