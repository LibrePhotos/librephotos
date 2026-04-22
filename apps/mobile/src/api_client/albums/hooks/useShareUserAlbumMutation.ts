import { useMutation } from '@tanstack/react-query'
import { notification } from '../../../service/notifications'
import { fetchClient, queryClient } from '../../api'
import { SharedAlbumsByMeQueryKeys } from './useFetchSharedAlbumsByMeQuery'
import { SharedAlbumsWithMeQueryKeys } from './useFetchSharedAlbumsWithMeQuery'
import { UserAlbumQueryKeys } from './useFetchUserAlbumQuery'
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery'

type ShareUserAlbumParams = {
  albumId: string
  userId: string
  share: boolean
}

export const useShareUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ albumId, userId, share }: ShareUserAlbumParams) => {
      await fetchClient.post('/useralbum/share/', {
        shared: share,
        album_id: albumId,
        target_user_id: userId,
      })
      notification.toggleAlbumSharing(share)
    },
    onSuccess: (_, { albumId }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] })
      queryClient.invalidateQueries({
        queryKey: [...UserAlbumQueryKeys, albumId],
      })
      queryClient.invalidateQueries({
        queryKey: [...SharedAlbumsByMeQueryKeys],
      })
      queryClient.invalidateQueries({
        queryKey: [...SharedAlbumsWithMeQueryKeys],
      })
    },
  })
