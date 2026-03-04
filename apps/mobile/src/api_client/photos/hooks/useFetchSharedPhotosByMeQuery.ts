import { useQuery } from '@tanstack/react-query'
import _ from 'lodash'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { PigPhoto, SimpleUser } from '../types'

export const SharedPhotosByMeQueryKeys = ['sharedPhotosByMe'] as const

const SharedPhotosByMeResponse = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUser,
      photo: PigPhoto,
    })
    .array(),
})

export const useFetchSharedPhotosByMeQuery = () =>
  useQuery({
    queryKey: [...SharedPhotosByMeQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/photos/shared/fromme/')
      const { results } = parseWithNotification(
        SharedPhotosByMeResponse,
        response,
        'Failed to parse shared photos by me',
      )
      const grouped = _.toPairs(_.groupBy(results, 'user_id')).map(el => ({
        userId: parseInt(el[0], 10),
        photos: el[1].map(item => item.photo),
      }))
      return grouped
    },
  })
