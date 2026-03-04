import { useQuery } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { LocationTimeline } from '../types'

export const LocationTimelineQueryKeys = ['locationTimeline'] as const

export const useLocationTimelineQuery = () =>
  useQuery({
    queryKey: [...LocationTimelineQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/locationtimeline/')
      return parseWithNotification(
        LocationTimeline,
        response,
        'Failed to parse location timeline',
      )
    },
  })
