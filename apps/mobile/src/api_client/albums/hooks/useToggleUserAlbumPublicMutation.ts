import { useMutation } from '@tanstack/react-query'
import { fetchClient, queryClient } from '../../api'
import { UserAlbumQueryKeys } from './useFetchUserAlbumQuery'
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery'

export type PublicSharingOptions = {
  share_location?: boolean | null
  share_camera_info?: boolean | null
  share_timestamps?: boolean | null
  share_captions?: boolean | null
  share_faces?: boolean | null
}

type ToggleUserAlbumPublicParams = {
  albumId: string
  public: boolean
  slug?: string
  expires_at?: string | null // ISO
  sharing_options?: PublicSharingOptions
}

export const useToggleUserAlbumPublicMutation = () =>
  useMutation({
    mutationFn: async ({
      albumId,
      public: isPublic,
      slug,
      expires_at,
      sharing_options,
    }: ToggleUserAlbumPublicParams) => {
      await fetchClient.post('/useralbum/makepublic', {
        album_id: albumId,
        val_public: isPublic,
        slug,
        expires_at,
        sharing_options,
      })
    },
    onSuccess: (_, { albumId }) => {
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] })
      queryClient.invalidateQueries({
        queryKey: [...UserAlbumQueryKeys, albumId],
      })
    },
  })
