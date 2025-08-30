import { useMutation } from '@tanstack/react-query';
import { fetchClient, queryClient } from '../../api';
import { RecentlyAddedPhotosQueryKeys } from '../../photos/hooks/useFetchRecentlyAddedPhotosQuery';
import { DateAlbumsQueryKeys } from '../../albums/hooks/useFetchDateAlbumsQuery';
import { CountStatsQueryKeys } from '../../stats/hooks/useFetchCountStatsQuery';
import { PhotoMonthCountQueryKeys } from '../../stats/hooks/useFetchPhotoMonthCountQuery';
import { StorageStatsQueryKeys } from '../../server/hooks/useFetchStorageStatsQuery';


const uploadFinished = (formData: FormData) => 
    fetchClient.post('/upload/complete/', formData)

export const useUploadFinishedMutation = () => useMutation({
        mutationFn: uploadFinished,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
            queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
            queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
            queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
            queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
        }
    });
