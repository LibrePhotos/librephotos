import { useMutation } from '@tanstack/react-query'
import { notification } from '../../../service/notifications'
import { fetchClient, queryClient } from '../../api'
import { RemovePhotoFromUserAlbumParams } from '../types'
import { UserAlbumQueryKeys } from './useFetchUserAlbumQuery'
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery'

export const useRemovePhotoFromUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({
      id,
      title,
      photos,
    }: RemovePhotoFromUserAlbumParams) => {
      await fetchClient.patch(`/albums/user/edit/${id}/`, {
        removedPhotos: photos,
      })
      notification.removePhotosFromAlbum(title, photos.length)
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] })
      queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, id] })
    },
  })
