import { useQuery } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { LocationSunburst } from '../types'

export const LocationTreeQueryKeys = ['locationTree'] as const

export const useFetchLocationTreeQuery = () =>
  useQuery({
    queryKey: [...LocationTreeQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/locationsunburst/')
      return parseWithNotification(
        LocationSunburst,
        response,
        'Failed to parse location tree',
      )
    },
  })
