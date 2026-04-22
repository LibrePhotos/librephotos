import { useMutation } from '@tanstack/react-query'
import { notification } from '../../../service/notifications'
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery'
import { fetchClient, queryClient } from '../../api'

export const useGenerateAutoAlbumsMutation = () =>
  useMutation({
    mutationFn: async () => {
      await fetchClient.post('/autoalbumgen/', {})
      notification.generateEventAlbums()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] })
    },
  })
