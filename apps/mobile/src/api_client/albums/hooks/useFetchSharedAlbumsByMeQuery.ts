import { useQuery } from '@tanstack/react-query'
import _ from 'lodash'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { UserAlbumList, UserAlbumListResponse } from '../types'

type UserAlbumsGroupedByUserId = {
  user_id: number
  albums: UserAlbumList[]
}

export const SharedAlbumsByMeQueryKeys = ['sharedAlbumsByMe'] as const

export const useFetchSharedAlbumsByMeQuery = () =>
  useQuery({
    queryKey: [...SharedAlbumsByMeQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/albums/user/shared/fromme/')
      const parsed = parseWithNotification(
        UserAlbumListResponse,
        response,
        'Failed to parse shared albums by me',
      ).results
      // Group albums by recipient (shared_to users)
      // Flatten: each album-recipient pair becomes an entry
      const albumsByRecipient: {
        recipientId: number
        album: (typeof parsed)[0]
      }[] = []
      parsed.forEach(album => {
        album.shared_to.forEach(recipient => {
          albumsByRecipient.push({ recipientId: recipient.id, album })
        })
      })
      // Group by recipient ID
      const grouped = _.toPairs(
        _.groupBy(albumsByRecipient, 'recipientId'),
      ).map(el => ({
        user_id: parseInt(el[0], 10),
        albums: el[1].map(item => item.album),
      })) as unknown as UserAlbumsGroupedByUserId[]
      return grouped
    },
  })
