import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { UserAlbumInfo } from '../../albums/types'
import { fetchClient } from '../../api'

const PhotoAlbumsResponse = z.object({
  results: UserAlbumInfo.array(),
})

export const PhotoAlbumsQueryKeys = ['photoAlbums'] as const

export const useFetchPhotoAlbumsQuery = (hash: string) =>
  useQuery({
    queryKey: [...PhotoAlbumsQueryKeys, hash],
    queryFn: async () => {
      if (!hash) {
        return []
      }
      const response = await fetchClient.get(`/photos/${hash}/albums/`)
      return parseWithNotification(
        PhotoAlbumsResponse,
        response,
        'Failed to parse photo albums',
      ).results
    },
    enabled: Boolean(hash),
  })
